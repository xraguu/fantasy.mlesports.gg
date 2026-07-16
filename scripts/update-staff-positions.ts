import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

const prisma = new PrismaClient();

interface CSVRow {
  name: string;
  salary: string;
  sprocket_player_id: string;
  member_id: string;
  skill_group: string;
  franchise: string;
  'Franchise Staff Position': string;
  slot: string;
  current_scrim_points: string;
  'Eligible Until': string;
}

async function updateStaffPositions() {
  console.log('Starting update of staff positions...');

  // Read the CSV file
  const csvPath = path.join(__dirname, '..', 'data', 'csv', 'players.csv');
  let csvContent = fs.readFileSync(csvPath, 'utf-8');

  // Remove quotes from all lines if present
  const lines = csvContent.split('\n');
  const cleanedLines = lines.map(line => {
    line = line.trim();
    if (line.startsWith('"') && line.endsWith('"')) {
      return line.slice(1, -1);
    }
    return line;
  });
  csvContent = cleanedLines.join('\n');

  // Parse CSV
  const records: CSVRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });

  console.log(`Found ${records.length} rows in CSV`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of records) {
    try {
      const memberId = row.member_id?.trim();
      const staffPosition = row['Franchise Staff Position']?.trim();
      const playerName = row.name?.trim();

      if (!memberId || !playerName) {
        skipped++;
        continue;
      }

      // Convert "NA" to null, otherwise use the actual value
      const staffPositionValue = staffPosition === 'NA' ? null : staffPosition;

      // Find player by id (the database id matches the CSV member_id)
      const player = await prisma.mLEPlayer.findUnique({
        where: { id: memberId },
        include: { team: true },
      });

      if (!player) {
        skipped++;
        continue;
      }

      // franchise always mirrors the player's actual rostered team (never the raw
      // CSV franchise column, which can hold stale values like "FP"/"Pend").
      const franchiseValue = player.team?.name ?? null;

      // Update staff position, franchise, and memberId
      await prisma.mLEPlayer.update({
        where: { id: player.id },
        data: {
          staffPosition: staffPositionValue,
          franchise: franchiseValue,
          memberId: memberId, // Also populate the memberId field
        },
      });

      updated++;

      if (updated % 100 === 0) {
        console.log(`Updated ${updated} records...`);
      }
    } catch (error) {
      console.error(`Error updating staff position for ${row.name}:`, error);
      errors++;
    }
  }

  console.log('\nUpdate complete!');
  console.log(`- Updated: ${updated}`);
  console.log(`- Skipped (player not found): ${skipped}`);
  console.log(`- Errors: ${errors}`);

  await prisma.$disconnect();
}

updateStaffPositions()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
