import { prisma } from "@/lib/prisma";
import { etDateTime } from "@/lib/timezone";
import { computeCalendarWeek } from "@/lib/currentWeek";
import { resetWaiverPriorityToReverseStandings } from "@/lib/waiverPriority";
import { generateRosterSlotId } from "@/lib/id-generator";

interface WeekDateConfig {
  week: number;
  startDate: string;
  endDate: string;
}

/**
 * Auto-locks lineups at 3:00am ET on a week's start date, and auto-unlocks
 * them at 11:59pm ET on that week's end date. There's no cron in this app,
 * so this runs lazily from the read/write paths that touch roster locks
 * (manager roster fetch/edit, admin Lock Lineups page).
 *
 * Each lock/unlock transition fires at most once per (league, week) — a
 * WeekLockEvent row is the dedup marker, so an admin's manual override via
 * the Lock Lineups page during the week doesn't get silently undone by this
 * sweep running again on the next page load.
 *
 * Also keeps FantasyLeague.currentWeek in sync with the calendar on every
 * run — that column used to be write-once (set to 1 at league creation and
 * never touched again), which meant every other part of the app that trusts
 * it (My Roster's default week, waiver/trade processing week, leave-league
 * gating, the admin Lock Lineups default) was silently stuck on week 1
 * forever. This is the one place already computing "what week is it" for
 * every active league, so it's the natural place to keep that column live.
 *
 * Also carries each manager's roster forward into a new week the moment it
 * starts (real `RosterSlot` rows copied from `week - 1`, not a live
 * reference) — the draft only ever creates week-1 rows, and nothing else in
 * the app created week 2+ rows on its own, so every later week silently
 * rendered empty. Copying real rows (rather than reading week 1 live for
 * every later week) is what makes "freeze after a week completes" possible
 * at all: once week N locks, a manager swapping their week N+1 lineup can
 * never retroactively change what week N's roster/scoring looked like.
 */
export async function runAutoLockSweep(leagueId?: string): Promise<void> {
  const leagues = await prisma.fantasyLeague.findMany({
    where: leagueId ? { id: leagueId } : undefined,
    select: {
      id: true,
      season: true,
      currentWeek: true,
      waiverSystem: true,
      fantasyTeams: { select: { id: true } },
    },
  });
  if (leagues.length === 0) return;

  const now = new Date();
  const settingsBySeason = new Map<number, WeekDateConfig[] | null>();

  for (const league of leagues) {
    // Self-healing safety net: bench slots should never be locked, full
    // stop, regardless of how they might have ended up that way (e.g. rows
    // locked before bench-exclusion existed, or any other edge case) — this
    // runs unconditionally every sweep, independent of the week-schedule
    // logic below, so a stuck bench slot can never persist past the next
    // time anything touches this league's locks.
    await prisma.rosterSlot.updateMany({
      where: { fantasyTeam: { fantasyLeagueId: league.id }, position: "be", isLocked: true },
      data: { isLocked: false },
    });

    if (!settingsBySeason.has(league.season)) {
      const settings = await prisma.seasonSettings.findFirst({
        where: { season: league.season },
      });
      settingsBySeason.set(
        league.season,
        (settings?.weekDates as WeekDateConfig[] | undefined) ?? null
      );
    }
    const weekDates = settingsBySeason.get(league.season);
    if (!weekDates || weekDates.length === 0) continue;

    const calendarWeek = computeCalendarWeek(weekDates);
    if (calendarWeek !== league.currentWeek) {
      await prisma.fantasyLeague.update({
        where: { id: league.id },
        data: { currentWeek: calendarWeek },
      });
    }

    const existingEvents = await prisma.weekLockEvent.findMany({
      where: { fantasyLeagueId: league.id },
      select: { week: true, type: true },
    });
    const fired = new Set(existingEvents.map((e) => `${e.week}:${e.type}`));

    // Ascending order matters here: each week's roster carry-forward copies
    // from week - 1, so week N must be processed after week N - 1 has
    // already been carried forward in this same pass.
    const sortedWeekDates = [...weekDates].sort((a, b) => a.week - b.week);

    for (const wd of sortedWeekDates) {
      if (
        wd.week > 1 &&
        wd.startDate &&
        !fired.has(`${wd.week}:roster_carry`)
      ) {
        const carryTrigger = etDateTime(wd.startDate, 3, 0);
        if (now >= carryTrigger) {
          for (const team of league.fantasyTeams) {
            const alreadyHasSlots = await prisma.rosterSlot.count({
              where: { fantasyTeamId: team.id, week: wd.week },
            });
            if (alreadyHasSlots > 0) continue;

            const prevWeekSlots = await prisma.rosterSlot.findMany({
              where: { fantasyTeamId: team.id, week: wd.week - 1 },
            });
            if (prevWeekSlots.length === 0) continue;

            await prisma.rosterSlot.createMany({
              data: prevWeekSlots.map((s) => ({
                id: generateRosterSlotId(team.id, wd.week, s.position, s.slotIndex),
                fantasyTeamId: team.id,
                mleTeamId: s.mleTeamId,
                week: wd.week,
                position: s.position,
                slotIndex: s.slotIndex,
                isLocked: false,
              })),
            });
          }

          await prisma.weekLockEvent.upsert({
            where: {
              fantasyLeagueId_week_type: {
                fantasyLeagueId: league.id,
                week: wd.week,
                type: "roster_carry",
              },
            },
            update: {},
            create: { fantasyLeagueId: league.id, week: wd.week, type: "roster_carry" },
          });
        }
      }

      if (wd.startDate && !fired.has(`${wd.week}:lock`)) {
        const lockTrigger = etDateTime(wd.startDate, 3, 0);
        if (now >= lockTrigger) {
          await prisma.rosterSlot.updateMany({
            where: {
              fantasyTeam: { fantasyLeagueId: league.id },
              week: wd.week,
              isLocked: false,
              position: { not: "be" }, // bench never locks — managers can always work the bench
            },
            data: { isLocked: true },
          });
          await prisma.weekLockEvent.upsert({
            where: {
              fantasyLeagueId_week_type: {
                fantasyLeagueId: league.id,
                week: wd.week,
                type: "lock",
              },
            },
            update: {},
            create: { fantasyLeagueId: league.id, week: wd.week, type: "lock" },
          });
        }
      }

      // "Fixed Order" waiver leagues reset priority to reverse standings the
      // moment each new week begins (same 3am ET boundary as the lineup
      // lock) — "Rolling" leagues deliberately never reset, so this is a
      // no-op for them. Fires once per (league, week) via the same
      // WeekLockEvent dedup table, a new "waiver_reset" event type.
      if (
        league.waiverSystem === "fixed" &&
        wd.startDate &&
        wd.week > 1 &&
        !fired.has(`${wd.week}:waiver_reset`)
      ) {
        const resetTrigger = etDateTime(wd.startDate, 3, 0);
        if (now >= resetTrigger) {
          await resetWaiverPriorityToReverseStandings(league.id, wd.week - 1);
          await prisma.weekLockEvent.upsert({
            where: {
              fantasyLeagueId_week_type: {
                fantasyLeagueId: league.id,
                week: wd.week,
                type: "waiver_reset",
              },
            },
            update: {},
            create: { fantasyLeagueId: league.id, week: wd.week, type: "waiver_reset" },
          });
        }
      }

      if (wd.endDate && !fired.has(`${wd.week}:unlock`)) {
        const unlockTrigger = etDateTime(wd.endDate, 23, 59);
        if (now >= unlockTrigger) {
          await prisma.rosterSlot.updateMany({
            where: {
              fantasyTeam: { fantasyLeagueId: league.id },
              week: wd.week,
              isLocked: true,
            },
            data: { isLocked: false },
          });
          await prisma.weekLockEvent.upsert({
            where: {
              fantasyLeagueId_week_type: {
                fantasyLeagueId: league.id,
                week: wd.week,
                type: "unlock",
              },
            },
            update: {},
            create: { fantasyLeagueId: league.id, week: wd.week, type: "unlock" },
          });
        }
      }
    }
  }
}
