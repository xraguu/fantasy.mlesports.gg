/**
 * One-off: deletes the 3 existing leagues (scoped deletion, not a global
 * wipe) and creates a fresh 8-manager league with xenn + 7 existing fake
 * test managers (LeagueManager1-7), for live testing. Draft is left
 * not_started so the real draft room can be tested end to end.
 */
import { prisma } from "../lib/prisma";
import { generateFantasyLeagueId, generateFantasyTeamId } from "../lib/id-generator";
import { generateAndSaveRegularSeason } from "../lib/scheduleGenerator";

const LEAGUE_IDS_TO_DELETE = ["19Test123-BNL14", "2026TestSheet2-JWT61", "19julytest-XCC65"];

async function deleteLeagues(leagueIds: string[]) {
  console.log(`Deleting ${leagueIds.length} league(s): ${leagueIds.join(", ")}`);

  await prisma.matchup.deleteMany({ where: { fantasyLeagueId: { in: leagueIds } } });
  await prisma.transaction.deleteMany({ where: { fantasyLeagueId: { in: leagueIds } } });
  await prisma.waiverClaim.deleteMany({ where: { fantasyLeagueId: { in: leagueIds } } });
  await prisma.trade.deleteMany({ where: { fantasyLeagueId: { in: leagueIds } } });
  await prisma.rosterSlot.deleteMany({
    where: { fantasyTeam: { fantasyLeagueId: { in: leagueIds } } },
  });
  await prisma.draftPick.deleteMany({ where: { fantasyLeagueId: { in: leagueIds } } });
  await prisma.weekLockEvent.deleteMany({ where: { fantasyLeagueId: { in: leagueIds } } });
  await prisma.teamWaiverPeriod.deleteMany({ where: { fantasyLeagueId: { in: leagueIds } } });
  await prisma.fantasyTeam.deleteMany({ where: { fantasyLeagueId: { in: leagueIds } } });
  const result = await prisma.fantasyLeague.deleteMany({ where: { id: { in: leagueIds } } });

  console.log(`✅ Deleted ${result.count} league(s) and all related data.`);
}

async function createTestLeague() {
  const xenn = await prisma.user.findUnique({ where: { discordId: "281233291343036418" } });
  if (!xenn) throw new Error("xenn user not found (discordId 281233291343036418)");

  const fakeManagers = await prisma.user.findMany({
    where: { discordId: { in: Array.from({ length: 7 }, (_, i) => `1763942242892000${i + 1}`) } },
    orderBy: { discordId: "asc" },
  });
  if (fakeManagers.length !== 7) {
    throw new Error(`Expected 7 fake managers (LeagueManager1-7), found ${fakeManagers.length}`);
  }

  const season = 2026; // reuse an existing season with real weekDates already configured
  const name = "Test League";
  const leagueId = generateFantasyLeagueId(season, name);

  const league = await prisma.fantasyLeague.create({
    data: {
      id: leagueId,
      name,
      season,
      maxTeams: 8,
      playoffTeams: 4,
      draftType: "snake",
      waiverSystem: "rolling",
      rosterConfig: { "2s": 2, "3s": 2, flx: 1, be: 3 },
      createdByUserId: xenn.id,
    },
  });
  console.log(`✅ Created league: ${league.id} (season ${season}, maxTeams 8)`);

  const managers = [
    { user: xenn, teamName: "xenn's Squad", shortCode: "XEN" },
    ...fakeManagers.map((u, i) => ({
      user: u,
      teamName: `${u.displayName}'s Squad`,
      shortCode: `M${i + 1}`,
    })),
  ];

  let draftPosition = 1;
  for (const m of managers) {
    const teamId = generateFantasyTeamId(leagueId, m.user.id);
    await prisma.fantasyTeam.create({
      data: {
        id: teamId,
        fantasyLeagueId: leagueId,
        ownerUserId: m.user.id,
        displayName: m.teamName,
        shortCode: m.shortCode,
        draftPosition,
        waiverPriority: draftPosition,
      },
    });
    console.log(`  ✅ Added team: ${m.teamName} (${m.user.displayName}, draft position ${draftPosition})`);
    draftPosition++;
  }

  const matchupsCreated = await generateAndSaveRegularSeason(leagueId);
  console.log(`✅ Auto-generated regular season schedule: ${matchupsCreated} matchups`);
  console.log(`\nDraft status: not_started — ready to test the live draft room.`);
  console.log(`League ID: ${leagueId}`);
}

async function main() {
  await deleteLeagues(LEAGUE_IDS_TO_DELETE);
  await createTestLeague();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
