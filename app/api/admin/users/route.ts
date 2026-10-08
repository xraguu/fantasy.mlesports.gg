import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentSeason } from "@/lib/currentWeek";

export async function GET() {
  const session = await auth();

  // Check if user is authenticated and is an admin
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Archived leagues (past seasons) are hidden everywhere else in the
    // admin panel, so a user's leagues here are only the active ones too.
    const currentSeason = await getCurrentSeason();

    // Fetch all users from database
    const users = await prisma.user.findMany({
      orderBy: {
        createdAt: "desc",
      },
      include: {
        fantasyTeams: {
          where: currentSeason !== null ? { league: { season: { gte: currentSeason } } } : undefined,
          select: { league: { select: { id: true, name: true } } },
        },
      },
    });

    return NextResponse.json(
      users.map(({ fantasyTeams, ...user }) => ({
        ...user,
        leagues: fantasyTeams
          .map((team) => team.league)
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
    );
  } catch (error) {
    console.error("Error fetching users:", error);
    return NextResponse.json(
      { error: "Failed to fetch users" },
      { status: 500 }
    );
  }
}
