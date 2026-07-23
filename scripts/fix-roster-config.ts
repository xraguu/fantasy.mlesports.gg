import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Update all leagues with Ceiling Shot Squad to have be: 8
  const leagues = await prisma.fantasyLeague.findMany({
    where: {
      fantasyTeams: {
        some: {
          displayName: "Ceiling Shot Squad",
        },
      },
    },
    select: {
      id: true,
      name: true,
      rosterConfig: true,
    },
  });

  console.log(`Found ${leagues.length} leagues with Ceiling Shot Squad\n`);

  for (const league of leagues) {
    console.log(`Updating league: ${league.name} (${league.id})`);
    console.log(`  Old config: ${JSON.stringify(league.rosterConfig)}`);

    const newConfig = {
      ...(league.rosterConfig as Record<string, unknown>),
      be: 8, // Temporarily set bench to 8 to show all drafted teams
    };

    await prisma.fantasyLeague.update({
      where: { id: league.id },
      data: {
        rosterConfig: newConfig,
      },
    });

    console.log(`  New config: ${JSON.stringify(newConfig)}`);
    console.log(`  ✅ Updated!\n`);
  }

  console.log("All leagues updated! Please refresh the page to see all 8 teams.");
  console.log("You can now use 'Edit Lineup' to move teams to the correct positions (2s, 3s, flx).");
}

main()
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
