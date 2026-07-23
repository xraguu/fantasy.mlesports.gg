import { prisma } from "../lib/prisma";

async function testOpponentsAPI() {
  console.log("Testing Opponents API logic...\n");

  // Simulate the API logic for Xenn's team
  const leagueId = "19Test123-BNL14"; // The actual league ID
  const currentUserId = "281233291343036418"; // xSkyGuy17x's user ID (to exclude from opponents)

  // Get league config
  const league = await prisma.fantasyLeague.findFirst({
    where: { id: leagueId },
    select: {
      id: true,
      name: true,
      currentWeek: true,
      rosterConfig: true,
    },
  });

  if (!league) {
    console.log("League not found!");
    return;
  }

  console.log(`League: ${league.name}`);
  console.log(`Roster Config:`, league.rosterConfig);

  // Parse roster config
  const rosterConfig = league.rosterConfig as Record<string, number>;
  const expectedSlots = [
    ...Array(rosterConfig["2s"] || 0).fill("2s"),
    ...Array(rosterConfig["3s"] || 0).fill("3s"),
    ...Array(rosterConfig.flx || 0).fill("FLX"),
    ...Array(rosterConfig.be || 0).fill("BE"),
  ];

  console.log(`Expected slots:`, expectedSlots);

  // Get opponents (excluding current user)
  const opponents = await prisma.fantasyTeam.findMany({
    where: {
      fantasyLeagueId: leagueId,
      ownerUserId: { not: currentUserId },
    },
    include: {
      owner: {
        select: {
          id: true,
          displayName: true,
        },
      },
    },
  });

  console.log(`\nFound ${opponents.length} opponents\n`);

  for (const team of opponents) {
    console.log(`--- ${team.displayName} (${team.owner.displayName}) ---`);

    // Get roster for week 1
    const week = 1;
    const rosterSlots = await prisma.rosterSlot.findMany({
      where: {
        fantasyTeamId: team.id,
        week,
      },
      include: {
        mleTeam: {
          include: {
            weeklyStats: {
              where: { week },
              take: 1,
            },
          },
        },
      },
      orderBy: [{ position: "asc" }, { slotIndex: "asc" }],
    });

    console.log(`  Database roster slots: ${rosterSlots.length}`);
    rosterSlots.forEach(slot => {
      console.log(`    - position: "${slot.position}", slotIndex: ${slot.slotIndex}, team: ${slot.mleTeam.leagueId} ${slot.mleTeam.name}`);
    });

    // Create a map of filled roster slots by position
    const filledSlots = new Map<string, typeof rosterSlots[0]>();
    rosterSlots.forEach(slot => {
      const key = `${slot.position}-${slot.slotIndex}`;
      filledSlots.set(key, slot);
      console.log(`    - Added to map: key="${key}"`);
    });

    // Test the position mapping logic
    console.log(`\n  Testing position mapping for expected slots:`);
    expectedSlots.forEach((slotName, index) => {
      let position = "";
      let slotIndex = 0;

      if (slotName === "2s") {
        position = "2s";
        slotIndex = expectedSlots.slice(0, index).filter(s => s === "2s").length;
      } else if (slotName === "3s") {
        position = "3s";
        slotIndex = expectedSlots.slice(0, index).filter(s => s === "3s").length;
      } else if (slotName === "FLX") {
        position = "FLX";
        slotIndex = expectedSlots.slice(0, index).filter(s => s === "FLX").length;
      } else if (slotName === "BE") {
        position = "BE";
        slotIndex = expectedSlots.slice(0, index).filter(s => s === "BE").length;
      }

      const key = `${position}-${slotIndex}`;
      const slot = filledSlots.get(key);

      if (slot) {
        console.log(`    ✓ Slot ${index}: ${slotName} -> key="${key}" -> FOUND: ${slot.mleTeam.leagueId} ${slot.mleTeam.name}`);
      } else {
        console.log(`    ✗ Slot ${index}: ${slotName} -> key="${key}" -> EMPTY`);
      }
    });

    console.log();
  }

  await prisma.$disconnect();
}

testOpponentsAPI().catch(console.error);
