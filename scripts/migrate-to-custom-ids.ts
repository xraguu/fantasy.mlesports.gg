/**
 * Migration script to convert existing database IDs to custom format
 *
 * This script will:
 * 1. Assign integer IDs to existing users (1, 2, 3, etc.)
 * 2. Convert FantasyLeague IDs to format: [Season][LeagueName]-[3Letters][2Numbers]
 * 3. Convert FantasyTeam IDs to format: [LeagueCode]-[UserID]-[TeamName]
 * 4. Update all foreign key references
 */

import { PrismaClient } from "@prisma/client";
import {
  generateFantasyLeagueId,
  generateFantasyTeamId,
  generateRosterSlotId
} from "../lib/id-generator";

const prisma = new PrismaClient();

interface OldToNewIdMapping {
  users: Map<string, number>;
  leagues: Map<string, string>;
  teams: Map<string, string>;
  rosterSlots: Map<string, string>;
}

async function main() {
  console.log("🚀 Starting ID migration...\n");

  const mapping: OldToNewIdMapping = {
    users: new Map(),
    leagues: new Map(),
    teams: new Map(),
    rosterSlots: new Map(),
  };

  try {
    // Step 1: Migrate Users to integer IDs
    console.log("📝 Step 1: Migrating User IDs to integers...");
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "asc" },
    });

    console.log(`Found ${users.length} users`);

    // Since you already have 2 users, we'll assign them IDs 1 and 2
    // New users will start from 3
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const newId = i + 1; // 1, 2, 3, etc.
      mapping.users.set(user.id, newId);
      console.log(`  User "${user.displayName}": ${user.id} → ${newId}`);
    }

    // Step 2: Migrate FantasyLeague IDs
    console.log("\n📝 Step 2: Migrating FantasyLeague IDs...");
    const leagues = await prisma.fantasyLeague.findMany();

    console.log(`Found ${leagues.length} leagues`);

    for (const league of leagues) {
      const newId = generateFantasyLeagueId(league.season, league.name);
      mapping.leagues.set(league.id, newId);
      console.log(`  League "${league.name}": ${league.id} → ${newId}`);
    }

    // Step 3: Migrate FantasyTeam IDs
    console.log("\n📝 Step 3: Migrating FantasyTeam IDs...");
    const teams = await prisma.fantasyTeam.findMany({
      include: {
        owner: true,
        league: true,
      },
    });

    console.log(`Found ${teams.length} teams`);

    for (const team of teams) {
      const oldUserId = team.ownerUserId;
      const newUserId = mapping.users.get(oldUserId);
      const newLeagueId = mapping.leagues.get(team.fantasyLeagueId);

      if (!newUserId || !newLeagueId) {
        console.error(`  ⚠️  Missing mapping for team ${team.id}`);
        continue;
      }

      const newTeamId = generateFantasyTeamId(newLeagueId, String(newUserId));
      mapping.teams.set(team.id, newTeamId);
      console.log(`  Team "${team.displayName}": ${team.id} → ${newTeamId}`);
    }

    // Step 4: Migrate RosterSlot IDs
    console.log("\n📝 Step 4: Migrating RosterSlot IDs...");
    const rosterSlots = await prisma.rosterSlot.findMany({
      include: {
        fantasyTeam: true,
      },
    });

    console.log(`Found ${rosterSlots.length} roster slots`);

    for (const slot of rosterSlots) {
      const newTeamId = mapping.teams.get(slot.fantasyTeamId);
      if (!newTeamId) {
        console.error(`  ⚠️  Missing team mapping for roster slot ${slot.id}`);
        continue;
      }

      const newSlotId = generateRosterSlotId(newTeamId, slot.week, slot.position, slot.slotIndex);
      mapping.rosterSlots.set(slot.id, newSlotId);
      console.log(`  Slot W${slot.week}-${slot.position}${slot.slotIndex}: ${slot.id} → ${newSlotId}`);
    }

    // Step 5: Apply migrations in correct order (to avoid FK constraint issues)
    console.log("\n📝 Step 5: Applying database migrations...");
    console.log("This will be done in a transaction to ensure data integrity.\n");

    await prisma.$transaction(async (tx) => {
      // 5a: Temporarily disable FK checks (PostgreSQL)
      await tx.$executeRawUnsafe("SET CONSTRAINTS ALL DEFERRED");

      // 5b: Update Users
      console.log("  Updating Users...");
      for (const [oldId, newId] of mapping.users) {
        await tx.$executeRawUnsafe(
          `UPDATE "User" SET id = $1 WHERE id = $2`,
          newId,
          oldId
        );
      }

      // Set the sequence to start from the next available ID
      const maxUserId = Math.max(...Array.from(mapping.users.values()));
      await tx.$executeRawUnsafe(
        `SELECT setval('"User_id_seq"', $1)`,
        maxUserId
      );

      // 5c: Update FantasyLeagues
      console.log("  Updating FantasyLeagues...");
      for (const [oldId, newId] of mapping.leagues) {
        const league = leagues.find(l => l.id === oldId);
        if (!league) continue;

        const newCreatedByUserId = mapping.users.get(league.createdByUserId);

        await tx.$executeRawUnsafe(
          `UPDATE "FantasyLeague"
           SET id = $1, "createdByUserId" = $2
           WHERE id = $3`,
          newId,
          newCreatedByUserId,
          oldId
        );
      }

      // 5d: Update FantasyTeams
      console.log("  Updating FantasyTeams...");
      for (const [oldId, newId] of mapping.teams) {
        const team = teams.find(t => t.id === oldId);
        if (!team) continue;

        const newUserId = mapping.users.get(team.ownerUserId);
        const newLeagueId = mapping.leagues.get(team.fantasyLeagueId);

        await tx.$executeRawUnsafe(
          `UPDATE "FantasyTeam"
           SET id = $1, "ownerUserId" = $2, "fantasyLeagueId" = $3
           WHERE id = $4`,
          newId,
          newUserId,
          newLeagueId,
          oldId
        );
      }

      // 5e: Update RosterSlots
      console.log("  Updating RosterSlots...");
      for (const [oldSlotId, newSlotId] of mapping.rosterSlots) {
        const slot = rosterSlots.find(s => s.id === oldSlotId);
        if (!slot) continue;

        const newTeamId = mapping.teams.get(slot.fantasyTeamId);

        await tx.$executeRawUnsafe(
          `UPDATE "RosterSlot" SET id = $1, "fantasyTeamId" = $2 WHERE id = $3`,
          newSlotId,
          newTeamId,
          oldSlotId
        );
      }

      // 5f: Update Trades
      console.log("  Updating Trades...");
      for (const [oldLeagueId, newLeagueId] of mapping.leagues) {
        await tx.$executeRawUnsafe(
          `UPDATE "Trade" SET "fantasyLeagueId" = $1 WHERE "fantasyLeagueId" = $2`,
          newLeagueId,
          oldLeagueId
        );
      }

      for (const [oldTeamId, newTeamId] of mapping.teams) {
        await tx.$executeRawUnsafe(
          `UPDATE "Trade" SET "proposerTeamId" = $1 WHERE "proposerTeamId" = $2`,
          newTeamId,
          oldTeamId
        );
        await tx.$executeRawUnsafe(
          `UPDATE "Trade" SET "receiverTeamId" = $1 WHERE "receiverTeamId" = $2`,
          newTeamId,
          oldTeamId
        );
      }

      for (const [oldUserId, newUserId] of mapping.users) {
        await tx.$executeRawUnsafe(
          `UPDATE "Trade" SET "proposerUserId" = $1 WHERE "proposerUserId" = $2`,
          newUserId,
          oldUserId
        );
        await tx.$executeRawUnsafe(
          `UPDATE "Trade" SET "receiverUserId" = $1 WHERE "receiverUserId" = $2`,
          newUserId,
          oldUserId
        );
      }

      // 5g: Update WaiverClaims
      console.log("  Updating WaiverClaims...");
      for (const [oldLeagueId, newLeagueId] of mapping.leagues) {
        await tx.$executeRawUnsafe(
          `UPDATE "WaiverClaim" SET "fantasyLeagueId" = $1 WHERE "fantasyLeagueId" = $2`,
          newLeagueId,
          oldLeagueId
        );
      }

      for (const [oldTeamId, newTeamId] of mapping.teams) {
        await tx.$executeRawUnsafe(
          `UPDATE "WaiverClaim" SET "fantasyTeamId" = $1 WHERE "fantasyTeamId" = $2`,
          newTeamId,
          oldTeamId
        );
      }

      for (const [oldUserId, newUserId] of mapping.users) {
        await tx.$executeRawUnsafe(
          `UPDATE "WaiverClaim" SET "userId" = $1 WHERE "userId" = $2`,
          newUserId,
          oldUserId
        );
      }

      // 5h: Update Transactions
      console.log("  Updating Transactions...");
      for (const [oldLeagueId, newLeagueId] of mapping.leagues) {
        await tx.$executeRawUnsafe(
          `UPDATE "Transaction" SET "fantasyLeagueId" = $1 WHERE "fantasyLeagueId" = $2`,
          newLeagueId,
          oldLeagueId
        );
      }

      for (const [oldTeamId, newTeamId] of mapping.teams) {
        await tx.$executeRawUnsafe(
          `UPDATE "Transaction" SET "fantasyTeamId" = $1 WHERE "fantasyTeamId" = $2`,
          newTeamId,
          oldTeamId
        );
        await tx.$executeRawUnsafe(
          `UPDATE "Transaction" SET "tradePartnerTeamId" = $1 WHERE "tradePartnerTeamId" = $2`,
          newTeamId,
          oldTeamId
        );
      }

      for (const [oldUserId, newUserId] of mapping.users) {
        await tx.$executeRawUnsafe(
          `UPDATE "Transaction" SET "userId" = $1 WHERE "userId" = $2`,
          newUserId,
          oldUserId
        );
      }

      // 5i: Update Matchups
      console.log("  Updating Matchups...");
      for (const [oldLeagueId, newLeagueId] of mapping.leagues) {
        await tx.$executeRawUnsafe(
          `UPDATE "Matchup" SET "fantasyLeagueId" = $1 WHERE "fantasyLeagueId" = $2`,
          newLeagueId,
          oldLeagueId
        );
      }

      for (const [oldTeamId, newTeamId] of mapping.teams) {
        await tx.$executeRawUnsafe(
          `UPDATE "Matchup" SET "homeFantasyTeamId" = $1 WHERE "homeFantasyTeamId" = $2`,
          newTeamId,
          oldTeamId
        );
        await tx.$executeRawUnsafe(
          `UPDATE "Matchup" SET "awayFantasyTeamId" = $1 WHERE "awayFantasyTeamId" = $2`,
          newTeamId,
          oldTeamId
        );
      }

      // 5j: Update DraftPicks
      console.log("  Updating DraftPicks...");
      for (const [oldLeagueId, newLeagueId] of mapping.leagues) {
        await tx.$executeRawUnsafe(
          `UPDATE "DraftPick" SET "fantasyLeagueId" = $1 WHERE "fantasyLeagueId" = $2`,
          newLeagueId,
          oldLeagueId
        );
      }

      for (const [oldTeamId, newTeamId] of mapping.teams) {
        await tx.$executeRawUnsafe(
          `UPDATE "DraftPick" SET "fantasyTeamId" = $1 WHERE "fantasyTeamId" = $2`,
          newTeamId,
          oldTeamId
        );
      }

      console.log("\n✅ All database updates completed successfully!");
    });

    console.log("\n✨ Migration completed successfully!");
    console.log("\nSummary:");
    console.log(`  - Users migrated: ${mapping.users.size}`);
    console.log(`  - Leagues migrated: ${mapping.leagues.size}`);
    console.log(`  - Teams migrated: ${mapping.teams.size}`);
    console.log(`  - Roster slots migrated: ${mapping.rosterSlots.size}`);

  } catch (error) {
    console.error("\n❌ Migration failed:", error);
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
