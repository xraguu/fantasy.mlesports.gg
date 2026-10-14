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
// Lineup reminders go out when lock is at most this far away
const REMINDER_WINDOW_MS = 24 * HOUR_MS;

/** Drafted, active-season leagues — or exactly `onlyLeagueIds` (for tests). */
async function activeDraftedLeagues(onlyLeagueIds?: string[]) {
  const select = { id: true, name: true, season: true, rosterConfig: true } as const;
  if (onlyLeagueIds) {
    return prisma.fantasyLeague.findMany({ where: { id: { in: onlyLeagueIds } }, select });
  }
  const currentSeason = await getCurrentSeason();
  if (currentSeason === null) {
    return [];
  }
  return prisma.fantasyLeague.findMany({
    where: { season: { gte: currentSeason }, draftStatus: "completed" },
    select,
  });
}

/** Each season's week calendar (start, lock, and end date of every week): season -> weeks. */
async function weekDatesBySeason(seasons: number[]): Promise<Map<number, WeekDateConfig[]>> {
  const rows = await prisma.seasonSettings.findMany({ where: { season: { in: [...new Set(seasons)] } } });
  // weekDates is stored as untyped JSON, so tell TypeScript its shape; a season without one has no weeks
  return new Map(rows.map((r) => [r.season, (r.weekDates as unknown as WeekDateConfig[] | null) ?? []]));
}

/** One decimal place, e.g. 245.3 */
function formatScore(points: number): string {
  return points.toFixed(1);
}

/** "you beat X 245.3 to 198.1", "you lost to X ...", or "you tied X at ..." */
function describeOutcome(opponentName: string, myScore: number, theirScore: number): string {
  if (myScore > theirScore) {
    return `you beat **${opponentName}** ${formatScore(myScore)} to ${formatScore(theirScore)}`;
  }
  if (myScore < theirScore) {
    return `you lost to **${opponentName}** ${formatScore(myScore)} to ${formatScore(theirScore)}`;
  }
  return `you tied **${opponentName}** at ${formatScore(myScore)}`;
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
      if (!wd.weekEnd) {
        continue;
      }
      // A week ends at 11:59 PM Eastern on its weekEnd date. Only announce it
      // between 12 hours and 7 days after that.
      const endedAt = etDateTime(wd.weekEnd, 23, 59).getTime();
      const tooSoon = now < endedAt + RESULTS_DELAY_MS;
      const tooLate = now > endedAt + RESULTS_WINDOW_MS;
      if (tooSoon || tooLate) {
        continue;
      }

      const matchups = await prisma.matchup.findMany({
        where: { fantasyLeagueId: league.id, week: wd.week },
        include: {
          homeTeam: { select: { id: true, displayName: true, ownerUserId: true } },
          awayTeam: { select: { id: true, displayName: true, ownerUserId: true } },
        },
      });
      if (matchups.length === 0) {
        continue;
      }

      // If any matchup is missing a score, alert admins and hold everyone's results
      const unscored = matchups.filter((m) => m.homeScore === null || m.awayScore === null).length;
      if (unscored > 0) {
        const hoursSinceEnd = Math.round((now - endedAt) / HOUR_MS);
        await queueAdminNotification("admin_alert", `unscored:${league.id}:${wd.week}`, {
          title: "Matchups still unscored",
          body: `**${league.name}** has ${unscored} Week ${wd.week} matchup${unscored === 1 ? "" : "s"} without a score, ${hoursSinceEnd} hours after the week ended. Managers' weekly results are waiting on it — check the stats refresh on the Database page, or recalculate on Manual Stats.`,
          url: siteUrl("/admin/stats"),
        });
        continue;
      }

      // Each team's win-loss record as of this week: team id -> standings row
      const standings = await getFantasyStandings(league.id, wd.week);
      const records = new Map(standings.map((s) => [s.teamId, s]));

      for (const m of matchups) {
        // Every score was checked above to be present (the ! tells TypeScript they aren't null).
        // Each matchup produces two DMs, one from each team's point of view.
        const sides = [
          { me: m.homeTeam, opponent: m.awayTeam, mine: m.homeScore!, theirs: m.awayScore! },
          { me: m.awayTeam, opponent: m.homeTeam, mine: m.awayScore!, theirs: m.homeScore! },
        ];
        for (const side of sides) {
          const outcome = describeOutcome(side.opponent.displayName, side.mine, side.theirs);
          const record = records.get(side.me.id);

          let body: string;
          if (m.isPlayoff) {
            body = `Week ${wd.week} playoff result in **${league.name}**: ${outcome}.`;
          } else {
            const recordText = record ? ` Your record is ${record.wins}–${record.losses}.` : "";
            body = `Week ${wd.week} final in **${league.name}**: ${outcome}.${recordText}`;
          }

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
    // Lineups lock at midnight Eastern at the start of a week's matchStart
    // date. Find the week whose lock is 1-24 hours away, if any.
    const upcoming = (datesBySeason.get(league.season) ?? []).find((wd) => {
      if (!wd.matchStart) {
        return false;
      }
      const untilLock = etDateTime(wd.matchStart, 0, 0).getTime() - now;
      return untilLock > HOUR_MS && untilLock <= REMINDER_WINDOW_MS;
    });
    if (!upcoming) {
      continue;
    }
    const week = upcoming.week;
    const lockAt = etDateTime(upcoming.matchStart, 0, 0);

    // How many starting slots the league has: 2s + 3s + flex (bench excluded)
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
      if (!playing) {
        continue;
      }
      // The week's own roster, or last week's until it carries forward
      let rows = slots.filter((s) => s.fantasyTeamId === team.id && s.week === week);
      if (rows.length === 0) {
        rows = slots.filter((s) => s.fantasyTeamId === team.id && s.week === week - 1);
      }
      if (rows.length === 0) {
        continue;
      }

      // Empty starting slots = starting slots minus filled non-bench ("be") slots
      const filledStarters = rows.filter((s) => s.position !== "be").length;
      const empty = starterSlots - filledStarters;
      if (empty <= 0) {
        continue;
      }
      await queueNotification(
        team.ownerUserId,
        "lineup_reminder",
        `lineup-reminder:${team.id}:${league.season}:${week}`,
        {
          title: "Your lineup has empty slots",
          body: `Your Week ${week} lineup in **${league.name}** has ${empty} empty starting slot${empty === 1 ? "" : "s"}. Lineups lock ${formatEasternDateTime(lockAt)}.`,
          url: siteUrl(`/leagues/${league.id}/my-roster/${team.id}`),
        },
        // No point sending it after lineups have locked
        { expiresAt: lockAt }
      );
    }
  }
}

/** Admin alert (at most once a day) when waiver claims sit unprocessed past their scheduled run. */
export async function notifyOverdueWaiverClaims(): Promise<void> {
  const leagues = await activeDraftedLeagues();
  const overdue = await countOverdueWaiverClaims(leagues.map((l) => l.id));
  if (overdue === 0) {
    return;
  }
  // Today's date in Eastern time as "YYYY-MM-DD" (the en-CA format), so the
  // key, and so the alert, changes once a day
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  await queueAdminNotification("admin_alert", `overdue-waivers:${today}`, {
    title: "Waiver claims are overdue",
    body: `${overdue} waiver claim${overdue === 1 ? " is" : "s are"} still pending more than 3 hours after their scheduled waiver run — automatic processing may not be running. You can run them by hand from the Transactions page.`,
    url: siteUrl("/admin/waivers"),
  });
}

/** Runs every calendar check; one failing doesn't stop the others. Called every 15 minutes. */
export async function runScheduledNotificationChecks(): Promise<void> {
  const checks: { label: string; run: () => Promise<void> }[] = [
    { label: "Weekly results", run: () => notifyWeeklyResults() },
    { label: "Lineup reminders", run: () => notifyLineupReminders() },
    { label: "Overdue waiver claims", run: () => notifyOverdueWaiverClaims() },
  ];
  for (const check of checks) {
    try {
      await check.run();
    } catch (error) {
      console.error(`[notifications] ${check.label} check failed:`, error);
    }
  }
}
