/**
 * Test schedule generation for a league
 */

import { PrismaClient } from "@prisma/client";
import {
  generateRegularSeasonSchedule,
  shuffleTeams,
} from "../lib/scheduleGenerator";

const prisma = new PrismaClient();

async function main() {
  const leagueId = process.argv[2] || "2026TestSheet2-JWT61";

  console.log(`🔧 Testing schedule generation for league: ${leagueId}\n`);

  // Fetch league with teams
  const league = await prisma.fantasyLeague.findUnique({
    where: { id: leagueId },
    include: {
      fantasyTeams: {
        orderBy: { draftPosition: "asc" },
      },
    },
  });

  if (!league) {
    console.error(`❌ League "${leagueId}" not found`);
    process.exit(1);
  }

  console.log(`✅ Found league: ${league.name}`);
  console.log(`   Teams: ${league.fantasyTeams.length}\n`);

  if (league.fantasyTeams.length < 2) {
    console.error("❌ Need at least 2 teams to generate a schedule");
    process.exit(1);
  }

  // Get team IDs
  const teamIds = league.fantasyTeams.map((team) => team.id);
  console.log("Teams in draft order:");
  league.fantasyTeams.forEach((team, i) => {
    console.log(`  ${i + 1}. ${team.displayName}`);
  });

  // Shuffle teams
  const shuffledTeamIds = shuffleTeams(teamIds);
  console.log("\nShuffled team order:");
  shuffledTeamIds.forEach((teamId, i) => {
    const team = league.fantasyTeams.find((t) => t.id === teamId);
    console.log(`  ${i + 1}. ${team?.displayName}`);
  });

  // Generate schedule
  console.log("\nGenerating regular season schedule (weeks 1-8)...\n");
  const matchups = generateRegularSeasonSchedule(shuffledTeamIds, league.maxTeams);

  // Group by week
  const matchupsByWeek = new Map<number, typeof matchups>();
  for (const matchup of matchups) {
    if (!matchupsByWeek.has(matchup.week)) {
      matchupsByWeek.set(matchup.week, []);
    }
    matchupsByWeek.get(matchup.week)!.push(matchup);
  }

  // Display schedule
  for (let week = 1; week <= 8; week++) {
    console.log(`Week ${week}:`);
    const weekMatchups = matchupsByWeek.get(week) || [];
    weekMatchups.forEach((matchup, i) => {
      const homeTeam = league.fantasyTeams.find((t) => t.id === matchup.homeTeamId);
      const awayTeam = league.fantasyTeams.find((t) => t.id === matchup.awayTeamId);
      console.log(`  ${i + 1}. ${homeTeam?.displayName} vs ${awayTeam?.displayName}`);
    });
    console.log();
  }

  console.log(`Total matchups generated: ${matchups.length}`);
  console.log(`Matchups per week: ${matchups.length / 8}`);

  // Verify each team plays once per week
  console.log("\n✓ Verifying schedule validity...");
  let isValid = true;

  for (let week = 1; week <= 8; week++) {
    const weekMatchups = matchupsByWeek.get(week) || [];
    const teamsInWeek = new Set<string>();

    for (const matchup of weekMatchups) {
      if (teamsInWeek.has(matchup.homeTeamId)) {
        console.error(`  ❌ Week ${week}: Team ${matchup.homeTeamId} appears twice`);
        isValid = false;
      }
      if (teamsInWeek.has(matchup.awayTeamId)) {
        console.error(`  ❌ Week ${week}: Team ${matchup.awayTeamId} appears twice`);
        isValid = false;
      }
      teamsInWeek.add(matchup.homeTeamId);
      teamsInWeek.add(matchup.awayTeamId);
    }

    if (isValid) {
      console.log(`  ✓ Week ${week}: All ${teamsInWeek.size} teams play exactly once`);
    }
  }

  if (isValid) {
    console.log("\n✅ Schedule is valid!");
    console.log("\nReady to save to database? Run the admin UI or API to create the schedule.");
  } else {
    console.log("\n❌ Schedule has errors!");
  }
}

main()
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
