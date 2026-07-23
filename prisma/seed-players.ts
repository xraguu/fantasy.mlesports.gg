import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";

const prisma = new PrismaClient();

// CSV record type
interface PlayerCSVRecord {
  name?: string;
  salary?: string;
  member_id?: string;
  skill_group?: string;
  franchise?: string;
  "Franchise Staff Position"?: string;
  slot?: string;
}

// Map full league names to abbreviations
const LEAGUE_MAP: Record<string, string> = {
  "Premier League": "PL",
  "Master League": "ML",
  "Champion League": "CL",
  "Academy League": "AL",
  "Foundation League": "FL",
};

// Map slot format from CSV to database format
function mapSlot(slot: string): string | null {
  if (slot === "NONE" || slot === "NA") return null;
  // PLAYERA -> A, PLAYERB -> B, etc.
  const match = slot.match(/PLAYER([A-H])/);
  if (match) return match[1];
  return null;
}

// Build team ID from franchise and skill group
function buildTeamId(franchise: string, skillGroup: string): string | null {
  // FP and Pend mean free agent
  if (franchise === "FP" || franchise === "Pend" || franchise === "NA") {
    return null;
  }

  const leagueAbbrev = LEAGUE_MAP[skillGroup];
  if (!leagueAbbrev) {
    console.warn(`Unknown skill group: ${skillGroup}`);
    return null;
  }

  // Remove spaces from franchise name and build ID
  const normalizedFranchise = franchise.replace(/\s+/g, "");
  return `${leagueAbbrev.toLowerCase()}${normalizedFranchise}`;
}

// Map staff position
function mapStaffPosition(position: string): string | null {
  if (position === "NA" || position === "NONE") return null;
  return position;
}

async function main() {
  console.log("🌱 Starting seed: MLE Players");

  const csvPath = path.join(process.cwd(), "data", "csv", "players.csv");
  let csvContent = fs.readFileSync(csvPath, "utf-8");

  // Remove the wrapping quotes if they exist (entire file is wrapped in one big quote)
  csvContent = csvContent.trim();
  if (csvContent.startsWith('"') && csvContent.endsWith('"')) {
    csvContent = csvContent.slice(1, -1);
  }

  const cleanedContent = csvContent;

  // Parse CSV with csv-parse
  const records = parse(cleanedContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true,
    escape: '"',
    quote: false, // Disable quote handling entirely
  }) as PlayerCSVRecord[];

  console.log(`📊 Found ${records.length} players to process`);

  // Debug: show first record
  if (records.length > 0) {
    console.log("First record sample:", {
      name: records[0].name,
      salary: records[0].salary,
      skill_group: records[0].skill_group,
      franchise: records[0].franchise,
    });
  }

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    // Clean leading/trailing quotes from field values
    const name = record.name?.replace(/^"+|"+$/g, '').trim();
    const salaryStr = record.salary?.trim();
    const memberId = record.member_id?.trim();
    const skillGroup = record.skill_group?.trim();
    const franchise = record.franchise?.trim();
    const staffPosition = record["Franchise Staff Position"]?.trim();
    const slot = record.slot?.trim();

    // Skip if essential fields are missing
    if (!name || !memberId) {
      errorCount++;
      continue;
    }

    try {
      const salary = salaryStr ? parseFloat(salaryStr) : null;
      const leagueAbbrev = skillGroup ? LEAGUE_MAP[skillGroup] : null;
      const teamId = (franchise && skillGroup) ? buildTeamId(franchise, skillGroup) : null;
      const rosterSlot = slot ? mapSlot(slot) : null;
      const position = staffPosition ? mapStaffPosition(staffPosition) : null;

      // Use member_id as the primary key
      const playerId = memberId;

      // Verify team exists if teamId is provided
      if (teamId) {
        const teamExists = await prisma.mLETeam.findUnique({
          where: { id: teamId },
        });

        // If team doesn't exist, set teamId to null (free agent)
        if (!teamExists) {
          await prisma.mLEPlayer.upsert({
            where: { id: playerId },
            update: {
              name,
              salary,
              memberId,
              skillGroup: leagueAbbrev || null,
              teamId: null,
              staffPosition: position,
              rosterSlot,
            },
            create: {
              id: playerId,
              name,
              salary,
              memberId,
              skillGroup: leagueAbbrev || null,
              teamId: null,
              staffPosition: position,
              rosterSlot,
            },
          });
        } else {
          await prisma.mLEPlayer.upsert({
            where: { id: playerId },
            update: {
              name,
              salary,
              memberId,
              skillGroup: leagueAbbrev || null,
              teamId,
              staffPosition: position,
              rosterSlot,
            },
            create: {
              id: playerId,
              name,
              salary,
              memberId,
              skillGroup: leagueAbbrev || null,
              teamId,
              staffPosition: position,
              rosterSlot,
            },
          });
        }
      } else {
        // No team - free agent
        await prisma.mLEPlayer.upsert({
          where: { id: playerId },
          update: {
            name,
            salary,
            memberId,
            skillGroup: leagueAbbrev || null,
            teamId: null,
            staffPosition: position,
            rosterSlot,
          },
          create: {
            id: playerId,
            name,
            salary,
            memberId,
            skillGroup: leagueAbbrev || null,
            teamId: null,
            staffPosition: position,
            rosterSlot,
          },
        });
      }

      successCount++;

      if (successCount % 500 === 0) {
        console.log(`  ✓ Processed ${successCount} players...`);
      }
    } catch (error) {
      console.error(`Error processing player ${name} (line ${i + 2}):`, error);
      errorCount++;
    }
  }

  console.log(`\n✅ Seed complete!`);
  console.log(`  ✓ Successfully added/updated: ${successCount} players`);
  if (errorCount > 0) {
    console.log(`  ⚠️  Errors: ${errorCount} players`);
  }
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
