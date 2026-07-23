import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();

async function main() {
  const timestamp = Date.now();
  const testUsers = [];

  for (let i = 1; i <= 10; i++) {
    testUsers.push({
      id: randomUUID(),
      discordId: `${timestamp}${i.toString().padStart(4, '0')}`,
      displayName: `LeagueManager${i}`
    });
  }

  console.log("Creating 10 test users...");

  for (const user of testUsers) {
    try {
      const created = await prisma.user.create({
        data: {
          id: user.id,
          discordId: user.discordId,
          displayName: user.displayName,
          role: "USER",
        },
      });
      console.log(`✓ Created: ${created.displayName} (Discord ID: ${user.discordId})`);
    } catch (error) {
      console.log(`✗ Failed to create ${user.displayName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  console.log("\nDone! Test users have been added to the database.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
