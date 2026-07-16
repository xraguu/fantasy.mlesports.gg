import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/activity
 * Most recent admin activity log entries.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const logs = await prisma.adminActivityLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 15,
      include: {
        admin: {
          select: { displayName: true },
        },
      },
    });

    return NextResponse.json({
      activity: logs.map((log) => ({
        id: log.id,
        admin: log.admin.displayName,
        action: log.action,
        description: log.description,
        createdAt: log.createdAt,
      })),
    });
  } catch (error) {
    console.error("Error fetching admin activity:", error);
    return NextResponse.json(
      { error: "Failed to fetch admin activity" },
      { status: 500 }
    );
  }
}
