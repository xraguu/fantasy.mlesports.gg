import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/activity
 * The full admin activity log, newest first — the dashboard's own UI
 * handles scrolling and date filtering client-side rather than this route
 * paging or filtering server-side.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const logs = await prisma.adminActivityLog.findMany({
      orderBy: { createdAt: "desc" },
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
