/**
 * Duplicates every fantasy team's week-1 RosterSlot rows into weeks 2-10,
 * for every fantasy league that has week-1 rosters. Idempotent (skipDuplicates).
 * fantasyPoints is left null — the scoring pass fills it in afterward.
 */
import { PrismaClient } from "@prisma/client";
import { generateRosterSlotId } from "../lib/id-generator";

const prisma = new PrismaClient();
const TARGET_WEEKS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

async function main() {
  const leagues = await prisma.fantasyLeague.findMany({
    include: { fantasyTeams: true },
  });

  let totalCreated = 0;

  for (const league of leagues) {
    for (const team of league.fantasyTeams) {
      const week1Slots = await prisma.rosterSlot.findMany({
        where: { fantasyTeamId: team.id, week: 1 },
      });

      if (week1Slots.length === 0) continue;

      const rows = [];
      for (const week of TARGET_WEEKS) {
        for (const slot of week1Slots) {
          rows.push({
            id: generateRosterSlotId(
              team.id,
              week,
              slot.position,
              slot.slotIndex,
            ),
            fantasyTeamId: team.id,
            mleTeamId: slot.mleTeamId,
            week,
            position: slot.position,
            slotIndex: slot.slotIndex,
            isLocked: false,
            fantasyPoints: null,
          });
        }
      }

      const result = await prisma.rosterSlot.createMany({
        data: rows,
        skipDuplicates: true,
      });
      totalCreated += result.count;
      console.log(
        `${league.id} / ${team.displayName}: created ${result.count} slots (of ${rows.length} attempted)`,
      );
    }
  }

  console.log(`\nTotal RosterSlot rows created: ${totalCreated}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
