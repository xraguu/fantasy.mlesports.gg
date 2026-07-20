import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentSeasonWeek } from "@/lib/currentWeek";
import { getTeamSeasonStats, getWithinLeagueStandings, getLeagueWideRanking } from "@/lib/teamSeasonStats";

/**
 * GET /api/mle-teams/[teamId]/overview
 * A single, consistent source for what the Team modal's header shows: real
 * 2s and 3s records (always both, regardless of which mode a caller was
 * last sorting by), each mode's MLE within-league standing (rank among the
 * ~32/16 teams in that same skill-group league), and each mode's fantasy
 * rank (cumulative fantasy points, that lens only, across every MLE team)
 * — sitewide, not scoped to any one fantasy league.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { teamId } = await params;

    const team = await prisma.mLETeam.findUnique({
      where: { id: teamId },
      select: { id: true },
    });
    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    const current = await getCurrentSeasonWeek();
    const throughWeek = current?.week ?? 1;

    const allMleTeams = await prisma.mLETeam.findMany({ select: { id: true } });
    const allMleTeamIds = allMleTeams.map((t) => t.id);

    // Every team's stats, fetched once per lens — getWithinLeagueStandings
    // and getLeagueWideRanking both need the same all-teams data, and this
    // team's own row is just a lookup into it, so there's no need for a
    // separate single-team query on top.
    const [allStats2s, allStats3s] = await Promise.all([
      getTeamSeasonStats({ teamIds: allMleTeamIds, throughWeek, lens: "2s" }),
      getTeamSeasonStats({ teamIds: allMleTeamIds, throughWeek, lens: "3s" }),
    ]);
    const [standing2s, standing3s, fantasyRanking2s, fantasyRanking3s] = await Promise.all([
      getWithinLeagueStandings(throughWeek, "2s", allStats2s),
      getWithinLeagueStandings(throughWeek, "3s", allStats3s),
      getLeagueWideRanking(throughWeek, "2s", allMleTeamIds, allStats2s),
      getLeagueWideRanking(throughWeek, "3s", allMleTeamIds, allStats3s),
    ]);

    return NextResponse.json({
      week: throughWeek,
      record2s: allStats2s.get(teamId)?.record ?? "0-0",
      record3s: allStats3s.get(teamId)?.record ?? "0-0",
      mleStanding2s: standing2s.get(teamId) ?? null,
      mleStanding3s: standing3s.get(teamId) ?? null,
      fantasyRank2s: fantasyRanking2s.get(teamId) ?? null,
      fantasyRank3s: fantasyRanking3s.get(teamId) ?? null,
      fantasyRankTotalTeams: allMleTeamIds.length,
    });
  } catch (error) {
    console.error("Error fetching MLE team overview:", error);
    return NextResponse.json(
      { error: "Failed to fetch team overview" },
      { status: 500 }
    );
  }
}
