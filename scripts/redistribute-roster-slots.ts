/**
 * Redistribute existing roster slots across positions based on roster config
 * This fixes leagues where all teams were imported to bench positions
 */

import { PrismaClient } from "@prisma/client";
import { generateRosterSlotId } from "../lib/id-generator";

const prisma = new PrismaClient();

async function main() {
  const leagueId = process.argv[2];

  if (!leagueId) {
    console.error("❌ Please provide a league ID");
    console.log("Usage: npx tsx scripts/redistribute-roster-slots.ts [leagueId]");
    process.exit(1);
  }

  console.log(`🔧 Redistributing roster slots for league: ${leagueId}\n`);

  // Fetch the league with teams and their roster slots
  const league = await prisma.fantasyLeague.findUnique({
    where: { id: leagueId },
    include: {
      fantasyTeams: {
        include: {
          roster: {
            where: { week: 1 },
            include: {
              mleTeam: true,
            },
            orderBy: { slotIndex: "asc" },
          },
        },
      },
    },
  });

  if (!league) {
    console.error(`❌ League "${leagueId}" not found`);
    process.exit(1);
  }

  console.log(`✅ Found league: ${league.name}`);
  console.log(`   Teams: ${league.fantasyTeams.length}`);
  console.log(`   Roster Config: ${JSON.stringify(league.rosterConfig)}\n`);

  const rosterConfig = (league.rosterConfig as Record<string, number>) || { "2s": 2, "3s": 2, "flx": 1, "be": 3 };

  // Process each team
  for (const team of league.fantasyTeams) {
    console.log(`Processing: ${team.displayName}`);
    console.log(`  Current roster slots: ${team.roster.length}`);

    // Get all MLE teams in draft order
    const mleTeams = team.roster
      .filter((slot) => slot.mleTeam !== null)
      .map((slot) => slot.mleTeam!);

    if (mleTeams.length === 0) {
      console.log(`  ⚠️  No teams to redistribute\n`);
      continue;
    }

    // Delete all existing roster slots for week 1
    await prisma.rosterSlot.deleteMany({
      where: {
        fantasyTeamId: team.id,
        week: 1,
      },
    });

    // Create new slots distributed across positions
    let pickIndex = 0;
    let slotsCreated = 0;

    const positions: Array<{ position: string; count: number }> = [
      { position: "2s", count: rosterConfig["2s"] || 0 },
      { position: "3s", count: rosterConfig["3s"] || 0 },
      { position: "flx", count: rosterConfig.flx || 0 },
      { position: "be", count: rosterConfig.be || 0 },
    ];

    for (const posConfig of positions) {
      for (let slotIndex = 0; slotIndex < posConfig.count; slotIndex++) {
        const mleTeam = mleTeams[pickIndex];

        if (mleTeam) {
          await prisma.rosterSlot.create({
            data: {
              id: generateRosterSlotId(team.id, 1, posConfig.position, slotIndex),
              fantasyTeamId: team.id,
              mleTeamId: mleTeam.id,
              week: 1,
              position: posConfig.position,
              slotIndex: slotIndex,
              isLocked: false,
            },
          });
          slotsCreated++;
          console.log(`    ✅ ${posConfig.position.toUpperCase()} slot ${slotIndex}: ${mleTeam.name} (${mleTeam.leagueId})`);
        }

        pickIndex++;
        if (pickIndex >= mleTeams.length) break;
      }
      if (pickIndex >= mleTeams.length) break;
    }

    console.log(`  ✅ Created ${slotsCreated} roster slots\n`);
  }

  // Reset roster config back to normal
  console.log("Resetting roster config to default (be: 3)...");
  await prisma.fantasyLeague.update({
    where: { id: leagueId },
    data: {
      rosterConfig: { "2s": 2, "3s": 2, "flx": 1, "be": 3 },
    },
  });

  console.log("\n✅ Done! All teams redistributed across positions.");
  console.log("Refresh the roster page to see the changes.");
}

main()
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
