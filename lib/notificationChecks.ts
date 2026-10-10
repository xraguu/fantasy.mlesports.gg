import { prisma } from "@/lib/prisma";
import { getCurrentSeason } from "@/lib/currentWeek";
import { getFantasyStandings } from "@/lib/standings";
import { etDateTime, formatEasternDateTime } from "@/lib/timezone";
import { countOverdueWaiverClaims } from "@/lib/waiverProcessing";
import { queueAdminNotification, queueNotification, siteUrl } from "@/lib/notifications";
import type { RosterConfigShape } from "@/lib/rosterSlotAssignment";
import type { WeekDateConfig } from "@/lib/weekMatchRange";

/**
 * Notifications that come from the calendar rather than from someone doing
 * something: weekly results, lineup reminders, and admin alerts. Run every
 * 15 minutes (instrumentation.ts). Each one is keyed by its event, so
 * running these as often as we like never repeats a DM.
 */

const HOUR_MS = 60 * 60 * 1000;
// Results go out this long after a week ends, so late stats have time to
// import and score first
const RESULTS_DELAY_MS = 12 * HOUR_MS;
// Weeks that ended longer ago than this are never announced (e.g. right
// after this feature is first deployed mid-season)
const RESULTS_WINDOW_MS = 7 * 24 * HOUR_MS;
const REMINDER_WINDOW_MS = 24 * HOUR_MS;

/** Drafted, active-season leagues — or exactly `onlyLeagueIds` (for tests). */
async function activeDraftedLeagues(onlyLeagueIds?: string[]) {
  const select = { id: true, name: true, season: true, rosterConfig: true } as const;
  if (onlyLeagueIds) {
    return prisma.fantasyLeague.findMany({ where: { id: { in: onlyLeagueIds } }, select });
  }
  const currentSeason = await getCurrentSeason();
  if (currentSeason === null) return [];
  return prisma.fantasyLeague.findMany({
    where: { season: { gte: currentSeason }, draftStatus: "completed" },
    select,
  });
}

async function weekDatesBySeason(seasons: number[]): Promise<Map<number, WeekDateConfig[]>> {
  const rows = await prisma.seasonSettings.findMany({ where: { season: { in: [...new Set(seasons)] } } });
  return new Map(rows.map((r) => [r.season, (r.weekDates as unknown as WeekDateConfig[] | null) ?? []]));
}

/**
 * "Week 3 final: you beat X 245.3 to 198.1. Your record is 3–0." — once a
 * week's matchups are all scored, 12 hours after it ends. If some are still
 * unscored by then, admins get an alert instead (results wait until they're
 * scored).
 */
export async function notifyWeeklyResults(onlyLeagueIds?: string[]): Promise<void> {
  const leagues = await activeDraftedLeagues(onlyLeagueIds);
  const datesBySeason = await weekDatesBySeason(leagues.map((l) => l.season));
  const now = Date.now();

  for (const league of leagues) {
    for (const wd of datesBySeason.get(league.season) ?? []) {
      if (!wd.weekEnd) continue;
      const endedAt = etDateTime(wd.weekEnd, 23, 59).getTime();
      if (now < endedAt + RESULTS_DELAY_MS || now > endedAt + RESULTS_WINDOW_MS) continue;

      const matchups = await prisma.matchup.findMany({
        where: { fantasyLeagueId: league.id, week: wd.week },
        include: {
          homeTeam: { select: { id: true, displayName: true, ownerUserId: true } },
          awayTeam: { select: { id: true, displayName: true, ownerUserId: true } },
        },
      });
      if (matchups.length === 0) continue;

      const unscored = matchups.filter((m) => m.homeScore === null || m.awayScore === null).length;
      if (unscored > 0) {
        await queueAdminNotification("admin_alert", `unscored:${league.id}:${wd.week}`, {
          title: "Matchups still unscored",
          body: `**${league.name}** has ${unscored} Week ${wd.week} matchup${unscored === 1 ? "" : "s"} without a score, ${Math.round((now - endedAt) / HOUR_MS)} hours after the week ended. Managers' weekly results are waiting on it — check the stats refresh on the Database page, or recalculate on Manual Stats.`,
          url: siteUrl("/admin/stats"),
        });
        continue;
      }

      const records = new Map((await getFantasyStandings(league.id, wd.week)).map((s) => [s.teamId, s]));
      for (const m of matchups) {
        const sides = [
          { me: m.homeTeam, opponent: m.awayTeam, mine: m.homeScore!, theirs: m.awayScore! },
          { me: m.awayTeam, opponent: m.homeTeam, mine: m.awayScore!, theirs: m.homeScore! },
        ];
        for (const side of sides) {
          const score = (n: number) => n.toFixed(1);
          const outcome =
            side.mine > side.theirs
              ? `you beat **${side.opponent.displayName}** ${score(side.mine)} to ${score(side.theirs)}`
              : side.mine < side.theirs
                ? `you lost to **${side.opponent.displayName}** ${score(side.mine)} to ${score(side.theirs)}`
                : `you tied **${side.opponent.displayName}** at ${score(side.mine)}`;
          const record = records.get(side.me.id);
          const body = m.isPlayoff
            ? `Week ${wd.week} playoff result in **${league.name}**: ${outcome}.`
            : `Week ${wd.week} final in **${league.name}**: ${outcome}.${record ? ` Your record is ${record.wins}–${record.losses}.` : ""}`;
          await queueNotification(side.me.ownerUserId, "weekly_result", `weekly-result:${m.id}:${side.me.id}`, {
            title: `Week ${wd.week} ${m.isPlayoff ? "playoff result" : "result"}`,
            body,
            url: siteUrl(`/leagues/${league.id}/scoreboard`),
          });
        }
      }
    }
  }
}

/**
 * About a day before lineups lock (between 24 hours and 1 hour out), a
 * reminder to anyone with empty starting slots (bench doesn't count) who
 * has a matchup that week.
 */
export async function notifyLineupReminders(onlyLeagueIds?: string[]): Promise<void> {
  const leagues = await activeDraftedLeagues(onlyLeagueIds);
  const datesBySeason = await weekDatesBySeason(leagues.map((l) => l.season));
  const now = Date.now();

  for (const league of leagues) {
    const upcoming = (datesBySeason.get(league.season) ?? []).find((wd) => {
      if (!wd.matchStart) return false;
      const untilLock = etDateTime(wd.matchStart, 0, 0).getTime() - now;
      return untilLock > HOUR_MS && untilLock <= REMINDER_WINDOW_MS;
    });
    if (!upcoming) continue;
    const week = upcoming.week;
    const lockAt = etDateTime(upcoming.matchStart, 0, 0);

    const config = league.rosterConfig as RosterConfigShape;
    const starterSlots = (config?.["2s"] || 0) + (config?.["3s"] || 0) + (config?.flx || 0);

    const teams = await prisma.fantasyTeam.findMany({
      where: { fantasyLeagueId: league.id },
      select: { id: true, ownerUserId: true },
    });
    const slots = await prisma.rosterSlot.findMany({
      where: { fantasyTeamId: { in: teams.map((t) => t.id) }, week: { in: [week, week - 1] } },
      select: { fantasyTeamId: true, week: true, position: true },
    });
    const matchups = await prisma.matchup.findMany({
      where: { fantasyLeagueId: league.id, week },
      select: { homeTeamId: true, awayTeamId: true },
    });

    for (const team of teams) {
      // A team with no matchup in a week that has matchups is on a bye
      const playing = matchups.length === 0 || matchups.some((m) => m.homeTeamId === team.id || m.awayTeamId === team.id);
      if (!playing) continue;
      // The week's own roster, or last week's until it carries forward
      let rows = slots.filter((s) => s.fantasyTeamId === team.id && s.week === week);
      if (rows.length === 0) rows = slots.filter((s) => s.fantasyTeamId === team.id && s.week === week - 1);
      if (rows.length === 0) continue;

      const empty = starterSlots - rows.filter((s) => s.position !== "be").length;
      if (empty <= 0) continue;
      await queueNotification(
        team.ownerUserId,
        "lineup_reminder",
        `lineup-reminder:${team.id}:${league.season}:${week}`,
        {
          title: "Your lineup has empty slots",
          body: `Your Week ${week} lineup in **${league.name}** has ${empty} empty starting slot${empty === 1 ? "" : "s"}. Lineups lock ${formatEasternDateTime(lockAt)}.`,
          url: siteUrl(`/leagues/${league.id}/my-roster/${team.id}`),
        },
        { expiresAt: lockAt }
      );
    }
  }
}

/** Admin alert (at most once a day) when waiver claims sit unprocessed past their scheduled run. */
export async function notifyOverdueWaiverClaims(): Promise<void> {
  const leagues = await activeDraftedLeagues();
  const overdue = await countOverdueWaiverClaims(leagues.map((l) => l.id));
  if (overdue === 0) return;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  await queueAdminNotification("admin_alert", `overdue-waivers:${today}`, {
    title: "Waiver claims are overdue",
    body: `${overdue} waiver claim${overdue === 1 ? " is" : "s are"} still pending more than 3 hours after their scheduled waiver run — automatic processing may not be running. You can run them by hand from the Transactions page.`,
    url: siteUrl("/admin/waivers"),
  });
}

export async function runScheduledNotificationChecks(): Promise<void> {
  for (const [label, check] of [
    ["Weekly results", () => notifyWeeklyResults()],
    ["Lineup reminders", () => notifyLineupReminders()],
    ["Overdue waiver claims", () => notifyOverdueWaiverClaims()],
  ] as const) {
    try {
      await check();
    } catch (error) {
      console.error(`[notifications] ${label} check failed:`, error);
    }
  }
}
