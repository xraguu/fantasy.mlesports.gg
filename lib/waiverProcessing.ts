import { prisma } from "./prisma";
import { findLockedSlotForTeam, lockedTeamErrorMessage } from "./rosterLocks";
import { markTeamDroppedForWaivers, clearWaiverPeriod, releaseWaiverPeriodsForLeague } from "./waiverPeriods";
import { moveTeamToBackOfWaiverLine } from "./waiverPriority";
import { assignTeamToRosterSlot } from "./rosterSlotAssignment";

export interface ProcessWaiversResult {
  processed: number;
  approved: number;
  denied: number;
  cancelled: number;
  errors: string[];
}

type ClaimWithTeam = Awaited<ReturnType<typeof fetchPendingClaims>>[number];

async function fetchPendingClaims(filter: { claimIds?: string[]; leagueId?: string }) {
  const whereClause: any = { status: "pending" };
  if (filter.claimIds) {
    whereClause.id = { in: filter.claimIds };
  } else if (filter.leagueId) {
    whereClause.fantasyLeagueId = filter.leagueId;
  }

  return prisma.waiverClaim.findMany({
    where: whereClause,
    orderBy: [
      { fantasyLeagueId: "asc" },
      { fantasyTeam: { waiverPriority: "asc" } },
      { createdAt: "asc" },
    ],
    include: {
      fantasyTeam: {
        include: {
          league: { select: { currentWeek: true, draftStatus: true, waiverSystem: true, rosterConfig: true } },
        },
      },
    },
  });
}

async function cancelClaim(claim: ClaimWithTeam, reason: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.waiverClaim.update({
      where: { id: claim.id },
      data: { status: "cancelled", processedAt: new Date() },
    });
    await tx.transaction.create({
      data: {
        fantasyLeagueId: claim.fantasyLeagueId,
        fantasyTeamId: claim.fantasyTeamId,
        userId: claim.userId,
        type: "waiver",
        addTeamId: claim.addTeamId,
        dropTeamId: claim.dropTeamId,
        waiverClaimId: claim.id,
        faabBid: claim.faabBid,
        status: "cancelled",
        reason,
        processedAt: new Date(),
      },
    });
  });
}

async function denyClaim(claim: ClaimWithTeam, reason: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.waiverClaim.update({
      where: { id: claim.id },
      data: { status: "denied", processedAt: new Date() },
    });
    await tx.transaction.create({
      data: {
        fantasyLeagueId: claim.fantasyLeagueId,
        fantasyTeamId: claim.fantasyTeamId,
        userId: claim.userId,
        type: "waiver",
        addTeamId: claim.addTeamId,
        dropTeamId: claim.dropTeamId,
        waiverClaimId: claim.id,
        faabBid: claim.faabBid,
        status: "denied",
        reason,
        processedAt: new Date(),
      },
    });
  });
}

/** Executes an approved claim's roster mutation, FAAB deduction, and history record. */
async function executeClaim(claim: ClaimWithTeam): Promise<void> {
  const week = claim.fantasyTeam.league.currentWeek;

  await prisma.$transaction(async (tx) => {
    await assignTeamToRosterSlot(tx, {
      fantasyTeamId: claim.fantasyTeamId,
      week,
      mleTeamId: claim.addTeamId,
      dropTeamId: claim.dropTeamId,
      rosterConfig: claim.fantasyTeam.league.rosterConfig,
    });

    await tx.waiverClaim.update({
      where: { id: claim.id },
      data: { status: "approved", processedAt: new Date() },
    });

    if (claim.faabBid && claim.faabBid > 0) {
      await tx.fantasyTeam.update({
        where: { id: claim.fantasyTeamId },
        data: { faabRemaining: { decrement: claim.faabBid } },
      });
    }

    await tx.transaction.create({
      data: {
        fantasyLeagueId: claim.fantasyLeagueId,
        fantasyTeamId: claim.fantasyTeamId,
        userId: claim.userId,
        type: "waiver",
        addTeamId: claim.addTeamId,
        dropTeamId: claim.dropTeamId,
        waiverClaimId: claim.id,
        faabBid: claim.faabBid,
        status: "approved",
        processedAt: new Date(),
      },
    });
  });

  await clearWaiverPeriod(claim.fantasyLeagueId, claim.addTeamId);
  if (claim.dropTeamId) {
    await markTeamDroppedForWaivers(claim.fantasyLeagueId, claim.dropTeamId);
  }
}

/**
 * Cancels a claim if its league's draft isn't complete, or if its drop team
 * is currently locked. Returns true if the claim was disposed of this way
 * (caller should skip it), false if it's still eligible to process.
 */
async function cancelIfIneligible(claim: ClaimWithTeam, results: ProcessWaiversResult): Promise<boolean> {
  if (claim.fantasyTeam.league.draftStatus !== "completed") {
    await cancelClaim(claim, "League's draft is not complete");
    results.cancelled++;
    return true;
  }

  if (claim.dropTeamId) {
    const lockedSlot = await findLockedSlotForTeam(
      claim.fantasyTeamId,
      claim.fantasyTeam.league.currentWeek,
      claim.dropTeamId
    );
    if (lockedSlot) {
      await cancelClaim(claim, lockedTeamErrorMessage(lockedSlot.mleTeam));
      results.cancelled++;
      return true;
    }
  }

  return false;
}

async function isTeamAlreadyRostered(claim: ClaimWithTeam): Promise<boolean> {
  const existing = await prisma.rosterSlot.findFirst({
    where: {
      mleTeamId: claim.addTeamId,
      week: claim.fantasyTeam.league.currentWeek,
      fantasyTeam: { fantasyLeagueId: claim.fantasyLeagueId },
    },
  });
  return !!existing;
}

/** Rolling/Fixed: claims process strictly in live waiver-priority order — the winner of a contested team moves to the back of the line, everyone else keeps their spot. */
async function processPriorityOrderedClaims(claims: ClaimWithTeam[], results: ProcessWaiversResult): Promise<void> {
  for (const claim of claims) {
    try {
      if (await cancelIfIneligible(claim, results)) continue;

      if (await isTeamAlreadyRostered(claim)) {
        await denyClaim(claim, "Team already rostered");
        results.denied++;
        continue;
      }

      await executeClaim(claim);
      await moveTeamToBackOfWaiverLine(claim.fantasyLeagueId, claim.fantasyTeamId);
      results.approved++;
    } catch (error) {
      console.error(`Error processing waiver claim ${claim.id}:`, error);
      results.errors.push(`Failed to process claim ${claim.id}`);
    }
  }
}

/** FAAB: claims contesting the same MLE team are resolved as a group — highest bid wins (ties broken by waiver priority, then submission time), the rest are denied as outbid. No priority movement — FAAB doesn't use a priority order. */
async function processFaabLeagueClaims(claims: ClaimWithTeam[], results: ProcessWaiversResult): Promise<void> {
  const eligible: ClaimWithTeam[] = [];
  for (const claim of claims) {
    try {
      if (await cancelIfIneligible(claim, results)) continue;
      eligible.push(claim);
    } catch (error) {
      console.error(`Error checking waiver claim ${claim.id}:`, error);
      results.errors.push(`Failed to process claim ${claim.id}`);
    }
  }

  const groups = new Map<string, ClaimWithTeam[]>();
  for (const claim of eligible) {
    if (!groups.has(claim.addTeamId)) groups.set(claim.addTeamId, []);
    groups.get(claim.addTeamId)!.push(claim);
  }

  for (const groupClaims of groups.values()) {
    try {
      if (await isTeamAlreadyRostered(groupClaims[0])) {
        for (const claim of groupClaims) {
          await denyClaim(claim, "Team already rostered");
          results.denied++;
        }
        continue;
      }

      const ranked = [...groupClaims].sort((a, b) => {
        const bidDiff = (b.faabBid ?? 0) - (a.faabBid ?? 0);
        if (bidDiff !== 0) return bidDiff;
        const priorityDiff = (a.fantasyTeam.waiverPriority ?? 999) - (b.fantasyTeam.waiverPriority ?? 999);
        if (priorityDiff !== 0) return priorityDiff;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });

      const [winner, ...losers] = ranked;
      await executeClaim(winner);
      results.approved++;

      for (const claim of losers) {
        await denyClaim(claim, `Outbid — winning bid was $${winner.faabBid ?? 0}`);
        results.denied++;
      }
    } catch (error) {
      console.error(`Error processing FAAB group for team ${groupClaims[0]?.addTeamId}:`, error);
      results.errors.push(`Failed to process claim(s) for team ${groupClaims[0]?.addTeamId}`);
    }
  }
}

/**
 * Processes every pending waiver claim matching the filter — the single
 * shared implementation used by both the admin manual "Run Waivers Now"
 * action and the lazy auto-processing sweep, so they can never drift apart.
 * Claims are grouped by league, then resolved per that league's
 * waiverSystem: FAAB leagues resolve contested teams by highest bid;
 * rolling/fixed leagues process in live waiver-priority order and rotate
 * the winner to the back of the line.
 */
export async function processPendingWaiverClaims(filter: { claimIds?: string[]; leagueId?: string }): Promise<ProcessWaiversResult> {
  const claims = await fetchPendingClaims(filter);

  if (claims.length === 0) {
    return { processed: 0, approved: 0, denied: 0, cancelled: 0, errors: [] };
  }

  const results: ProcessWaiversResult = { processed: claims.length, approved: 0, denied: 0, cancelled: 0, errors: [] };

  const claimsByLeague = new Map<string, ClaimWithTeam[]>();
  for (const claim of claims) {
    if (!claimsByLeague.has(claim.fantasyLeagueId)) claimsByLeague.set(claim.fantasyLeagueId, []);
    claimsByLeague.get(claim.fantasyLeagueId)!.push(claim);
  }

  for (const [, leagueClaims] of claimsByLeague) {
    const waiverSystem = leagueClaims[0].fantasyTeam.league.waiverSystem;
    if (waiverSystem === "faab") {
      await processFaabLeagueClaims(leagueClaims, results);
    } else {
      await processPriorityOrderedClaims(leagueClaims, results);
    }
  }

  for (const touchedLeagueId of claimsByLeague.keys()) {
    await releaseWaiverPeriodsForLeague(touchedLeagueId);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Lazy auto-processing sweep
// ---------------------------------------------------------------------------

interface WaiverScheduleEntry {
  day: string;
  time: string;
}

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}

function nowInEastern(): { dayOfWeek: string; minutesOfDay: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const dayOfWeek = parts.find((p) => p.type === "weekday")?.value ?? "";
  let hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  if (hour === 24) hour = 0;
  return { dayOfWeek, minutesOfDay: hour * 60 + minute };
}

function isPastAScheduledWaiverTimeToday(schedule: WaiverScheduleEntry[]): boolean {
  if (!Array.isArray(schedule) || schedule.length === 0) return false;
  const { dayOfWeek, minutesOfDay } = nowInEastern();
  return schedule.some((entry) => entry.day === dayOfWeek && minutesOfDay >= parseTimeToMinutes(entry.time));
}

/**
 * Lazily auto-processes pending waiver claims once the current ET day/time
 * is at or past one of the league's season's configured waiver-schedule
 * entries (Admin Settings → Waiver Schedule). There's no cron in this app,
 * so this runs off read paths that touch waivers (same lazy-sweep pattern
 * as lib/autoLock.ts). Safe to call on every request — processing only ever
 * touches claims still "pending", so re-running it after a day's batch is
 * already done is a harmless no-op, no dedup marker needed.
 */
export async function runWaiverProcessingSweep(leagueId?: string): Promise<void> {
  const leagues = await prisma.fantasyLeague.findMany({
    where: { draftStatus: "completed", ...(leagueId ? { id: leagueId } : {}) },
    select: { id: true, season: true },
  });
  if (leagues.length === 0) return;

  const seasons = [...new Set(leagues.map((l) => l.season))];
  const settingsBySeason = new Map<number, WaiverScheduleEntry[]>();
  for (const season of seasons) {
    const settings = await prisma.seasonSettings.findFirst({ where: { season } });
    settingsBySeason.set(season, (settings?.waiverSchedule as WaiverScheduleEntry[] | undefined) ?? []);
  }

  const dueLeagueIds = leagues
    .filter((l) => isPastAScheduledWaiverTimeToday(settingsBySeason.get(l.season) ?? []))
    .map((l) => l.id);

  for (const dueLeagueId of dueLeagueIds) {
    try {
      await processPendingWaiverClaims({ leagueId: dueLeagueId });
    } catch (error) {
      console.error(`Auto waiver processing failed for league ${dueLeagueId}:`, error);
    }
  }
}
