import { prisma } from "./prisma";
import { getFantasyStandings } from "./standings";

/**
 * Sets every team's waiver priority from reverse draft order (last team to
 * pick gets priority #1, first team to pick gets priority #maxTeams) — the
 * starting order for both "rolling" and "fixed" leagues. No-op for "faab"
 * leagues, which don't use a priority order at all. Called once, at draft
 * completion (normal last-pick completion or an admin Skip Draft).
 */
export async function initializeWaiverPriorityFromDraftOrder(leagueId: string): Promise<void> {
  const league = await prisma.fantasyLeague.findUnique({
    where: { id: leagueId },
    select: {
      waiverSystem: true,
      fantasyTeams: { select: { id: true, draftPosition: true } },
    },
  });
  if (!league || league.waiverSystem === "faab") return;

  const ordered = [...league.fantasyTeams].sort((a, b) => (b.draftPosition ?? 0) - (a.draftPosition ?? 0));

  await prisma.$transaction(
    ordered.map((team, index) =>
      prisma.fantasyTeam.update({
        where: { id: team.id },
        data: { waiverPriority: index + 1 },
      })
    )
  );
}

/**
 * Moves a team to the back of the waiver-priority line after a SUCCESSFUL
 * claim — every other team keeps its relative spot (a team with no
 * successful claims never loses ground, it just gets passed by whoever's
 * ahead of it winning and moving to the back). Renumbers the whole league
 * 1..N so `waiverPriority` always stays directly displayable. No-op for
 * "faab" leagues.
 */
export async function moveTeamToBackOfWaiverLine(leagueId: string, winningTeamId: string): Promise<void> {
  const league = await prisma.fantasyLeague.findUnique({
    where: { id: leagueId },
    select: {
      waiverSystem: true,
      fantasyTeams: { select: { id: true, waiverPriority: true } },
    },
  });
  if (!league || league.waiverSystem === "faab") return;

  const rest = league.fantasyTeams
    .filter((t) => t.id !== winningTeamId)
    .sort((a, b) => (a.waiverPriority ?? 999) - (b.waiverPriority ?? 999));
  const winner = league.fantasyTeams.find((t) => t.id === winningTeamId);
  if (!winner) return;

  const reordered = [...rest, winner];

  await prisma.$transaction(
    reordered.map((team, index) =>
      prisma.fantasyTeam.update({
        where: { id: team.id },
        data: { waiverPriority: index + 1 },
      })
    )
  );
}

/**
 * "Fixed Order" leagues reset priority every week to reverse current
 * standings (worst record gets priority #1) — unlike "rolling" leagues,
 * which keep rotating the same line all season and never reset. Called once
 * per (league, week) from lib/autoLock.ts's sweep, right as a new week
 * begins, using standings through the week that just ended.
 */
export async function resetWaiverPriorityToReverseStandings(leagueId: string, throughWeek: number): Promise<void> {
  const league = await prisma.fantasyLeague.findUnique({
    where: { id: leagueId },
    select: { waiverSystem: true },
  });
  if (!league || league.waiverSystem !== "fixed") return;

  const standings = await getFantasyStandings(leagueId, throughWeek);
  if (standings.length === 0) return;

  // Worst rank (highest number) goes first in line.
  const reversed = [...standings].sort((a, b) => b.rank - a.rank);

  await prisma.$transaction(
    reversed.map((s, index) =>
      prisma.fantasyTeam.update({
        where: { id: s.teamId },
        data: { waiverPriority: index + 1 },
      })
    )
  );
}
