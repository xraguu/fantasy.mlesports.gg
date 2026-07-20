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
 * Auto-locks lineups at 12:00am ET on a week's start date (the instant the
 * calendar date becomes that week's start date), and auto-unlocks them at
 * 11:59pm ET on that week's end date. There's no cron in this app,
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
      // Carry-forward is a genuine one-shot event per (league, week): once
      // it's happened, it must NEVER run again for that week, even if a
      // manager later legitimately drops a team and that week's slot count
      // drops below a "full roster." Judging "already done" from the
      // CURRENT slot count (an earlier version of this fix did exactly
      // that) is wrong for precisely that reason — a manager dropping a
      // team makes their roster look "incomplete" by slot count alone, and
      // re-triggering carry-forward in response silently un-drops it by
      // copying the same slot back in from the previous week (pulling
      // whatever team occupies that position there, which can be a
      // DIFFERENT team already rostered elsewhere — surfacing as a
      // duplicate team on the roster, and the drop never sticking).
      //
      // The real fix for the original race (several overlapping sweep
      // calls, from ordinary page-load GETs with no mutex between them,
      // all trying to carry-forward the same week at once — e.g. right
      // after a draft finishes on a league whose whole schedule is already
      // in the past) is to claim the WeekLockEvent marker ATOMICALLY and
      // FIRST, via a plain `create` that throws on an existing row, before
      // touching any roster data — not `upsert` it after copying, like the
      // lock/unlock steps below still correctly do for their own concerns.
      // A losing concurrent sweep's `create` throws immediately and it
      // backs off having done nothing, instead of two invocations both
      // reading/copying the same week and one of them corrupting the
      // result. Once claimed, the copy is a single atomic multi-row
      // INSERT — all-or-nothing — so there's no way for this to land a
      // partial roster the way the pre-atomic-claim version could.
      if (wd.week > 1 && wd.startDate && !fired.has(`${wd.week}:roster_carry`)) {
        const carryTrigger = etDateTime(wd.startDate, 0, 0);
        if (now >= carryTrigger) {
          let claimed = true;
          try {
            await prisma.weekLockEvent.create({
              data: { fantasyLeagueId: league.id, week: wd.week, type: "roster_carry" },
            });
          } catch {
            claimed = false; // another sweep already claimed this (league, week)
          }

          if (claimed) {
            fired.add(`${wd.week}:roster_carry`);

            // Batched across every team in the league — was 2-3 sequential
            // queries PER TEAM (a count, a findMany, a createMany), which
            // multiplies badly the moment several weeks become due in the
            // same sweep pass (e.g. a draft finishing on a schedule that's
            // already well underway). One findMany covering both the
            // target and source week for every team, grouped in memory,
            // then a single createMany for every team's missing rows.
            const teamIds = league.fantasyTeams.map((t) => t.id);
            const bothWeeksSlots = await prisma.rosterSlot.findMany({
              where: { fantasyTeamId: { in: teamIds }, week: { in: [wd.week, wd.week - 1] } },
            });

            const targetWeekTeamIds = new Set(
              bothWeeksSlots.filter((s) => s.week === wd.week).map((s) => s.fantasyTeamId)
            );
            const prevWeekByTeam = new Map<string, typeof bothWeeksSlots>();
            for (const s of bothWeeksSlots) {
              if (s.week !== wd.week - 1) continue;
              if (!prevWeekByTeam.has(s.fantasyTeamId)) prevWeekByTeam.set(s.fantasyTeamId, []);
              prevWeekByTeam.get(s.fantasyTeamId)!.push(s);
            }

            const newRows = teamIds
              .filter((id) => !targetWeekTeamIds.has(id))
              .flatMap((teamId) => prevWeekByTeam.get(teamId) ?? [])
              .map((s) => ({
                id: generateRosterSlotId(s.fantasyTeamId, wd.week, s.position, s.slotIndex),
                fantasyTeamId: s.fantasyTeamId,
                mleTeamId: s.mleTeamId,
                week: wd.week,
                position: s.position,
                slotIndex: s.slotIndex,
                isLocked: false,
              }));

            if (newRows.length > 0) {
              await prisma.rosterSlot.createMany({ data: newRows });
            }
          }
        }
      }

      if (wd.startDate && !fired.has(`${wd.week}:lock`)) {
        const lockTrigger = etDateTime(wd.startDate, 0, 0);
        if (now >= lockTrigger) {
          const locked = await prisma.rosterSlot.updateMany({
            where: {
              fantasyTeam: { fantasyLeagueId: league.id },
              week: wd.week,
              isLocked: false,
              position: { not: "be" }, // bench never locks — managers can always work the bench
            },
            data: { isLocked: true },
          });
          // Only mark this (league, week) as "done" once it's actually
          // locked something — if this pass locked zero rows, the roster
          // for that week doesn't exist yet (e.g. a draft that finishes
          // after this week's own lock boundary has already passed, which
          // is the norm for a late draft, or carry-forward hasn't reached
          // this week yet). Marking it "done" anyway was the actual bug:
          // this is a one-shot marker that never retries, so any roster
          // rows that show up afterward (from that late draft, carry-
          // forward, a trade, a waiver pickup) would never get locked at
          // all, for the rest of the week. Leaving it unmarked here means
          // the next sweep tries again — cheap when there's genuinely
          // nothing yet, and correctly catches the real rows the moment
          // they exist. Once it locks at least one real row, the marker
          // sticks for good, still protecting an admin's deliberate
          // mid-week unlock via the Lock Lineups page from being silently
          // re-locked by this sweep.
          if (locked.count > 0) {
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
      }

      // "Fixed Order" waiver leagues reset priority to reverse standings the
      // moment each new week begins (same midnight ET boundary as the
      // lineup lock) — "Rolling" leagues deliberately never reset, so this
      // is a no-op for them. Fires once per (league, week) via the same
      // WeekLockEvent dedup table, a new "waiver_reset" event type.
      if (
        league.waiverSystem === "fixed" &&
        wd.startDate &&
        wd.week > 1 &&
        !fired.has(`${wd.week}:waiver_reset`)
      ) {
        const resetTrigger = etDateTime(wd.startDate, 0, 0);
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
