import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    console.log('Creating Transaction table...');

    // Create the table
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Transaction" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "fantasyLeagueId" TEXT NOT NULL,
        "fantasyTeamId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "addTeamId" TEXT,
        "dropTeamId" TEXT,
        "tradeId" TEXT,
        "tradePartnerTeamId" TEXT,
        "tradePartnerGave" TEXT[] DEFAULT ARRAY[]::TEXT[],
        "waiverClaimId" TEXT,
        "faabBid" INTEGER,
        "status" TEXT NOT NULL,
        "reason" TEXT,
        "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Transaction_fantasyLeagueId_fkey" FOREIGN KEY ("fantasyLeagueId") REFERENCES "FantasyLeague"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "Transaction_fantasyTeamId_fkey" FOREIGN KEY ("fantasyTeamId") REFERENCES "FantasyTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
      )
    `);

    // Create indexes
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Transaction_fantasyLeagueId_idx" ON "Transaction"("fantasyLeagueId")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Transaction_fantasyTeamId_idx" ON "Transaction"("fantasyTeamId")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Transaction_processedAt_idx" ON "Transaction"("processedAt")`);

    console.log('✅ Transaction table created successfully!');
  } catch (error) {
    console.error('Error creating Transaction table:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
