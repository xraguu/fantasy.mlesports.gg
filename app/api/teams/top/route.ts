import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSeasonWeek } from "@/lib/currentWeek";
import { etDateTime } from "@/lib/timezone";
import type { WeekDateConfig } from "@/lib/weekMatchRange";
import { getTeamSeasonStats, GamemodeLens, compareByFpts } from "@/lib/teamSeasonStats";

/**
 * GET /api/teams/top
 * Top 10 MLE teams by cumulative season fantasy points, for each of three
 * lenses: 2s-only, 3s-only, and combined (2s+3s summed).
 */
export async function GET() {
  try {
    // The real MLE match data already exists for every configured week
    // (the season's already over), but this app still paces fantasy stats
    // one week at a time — this used to take the LAST configured week
    // unconditionally (effectively always the full season), which meant
    // this list was showing full-season totals no matter what week it
    // actually is. `getCurrentSeasonWeek` is the same real "what week is
    // it right now" the automatic stats refresh itself uses.
    const current = await getCurrentSeasonWeek();
    if (!current) {
      return NextResponse.json({ throughWeek: null, twoS: [], threeS: [], combined: [] });
    }

    // Count only through the latest week of the current season whose
    // matches have actually started — a week that hasn't reached match day
    // has no stats yet (its Score would just be 0), and before the season's
    // first match there's no data at all, so the table stays empty.
    const settings = await prisma.seasonSettings.findFirst({ where: { season: current.season } });
    const weekDates = (settings?.weekDates as WeekDateConfig[] | undefined) ?? [];
    const now = new Date();
    const startedWeeks = weekDates
      .filter((wd) => wd.week <= current.week && wd.matchStart && now >= etDateTime(wd.matchStart, 0, 0))
      .map((wd) => wd.week);
    if (startedWeeks.length === 0) {
      return NextResponse.json({ throughWeek: null, twoS: [], threeS: [], combined: [] });
    }
    const throughWeek = Math.max(...startedWeeks);

    const teams = await prisma.mLETeam.findMany({
      select: {
        id: true,
        name: true,
        leagueId: true,
        slug: true,
        logoPath: true,
        primaryColor: true,
        secondaryColor: true,
      },
    });
    const teamIds = teams.map((t) => t.id);
    const teamById = new Map(teams.map((t) => [t.id, t]));

    const buildTop10 = async (lens: GamemodeLens) => {
      const stats = await getTeamSeasonStats({ teamIds, season: current.season, throughWeek, lens });
      return [...stats.values()]
        .filter((s) => s.weeksPlayed > 0)
        .sort(compareByFpts)
        .slice(0, 10)
        .map((s, index) => {
          const team = teamById.get(s.teamId)!;
          return {
            id: team.id,
            name: team.name,
            leagueId: team.leagueId,
            slug: team.slug,
            logoPath: team.logoPath,
            primaryColor: team.primaryColor,
            secondaryColor: team.secondaryColor,
            rank: index + 1,
            fpts: s.fpts,
            avg: s.avg,
            score: s.score,
            last: s.last,
            goals: s.goals,
            shots: s.shots,
            saves: s.saves,
            assists: s.assists,
            demos: s.demosInflicted,
            record: s.record,
          };
        });
    };

    const [twoS, threeS, combined] = await Promise.all([
      buildTop10("2s"),
      buildTop10("3s"),
      buildTop10("combined"),
    ]);

    return NextResponse.json({ throughWeek, twoS, threeS, combined });
  } catch (error) {
    console.error("Error fetching top teams:", error);
    return NextResponse.json(
      { error: "Failed to fetch top teams" },
      { status: 500 }
    );
  }
}
