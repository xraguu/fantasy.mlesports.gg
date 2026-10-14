import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isDiscordConfigured } from "@/lib/discord";
import {
  isNotificationType,
  NOTIFICATION_TYPES,
  queueNotification,
  sendNotificationNow,
  siteUrl,
} from "@/lib/notifications";

/** The readable name for a stored notification type, e.g. "trade_offer" -> "Trade offers". */
function typeLabel(type: string): string {
  if (isNotificationType(type)) {
    return NOTIFICATION_TYPES[type].label;
  }
  if (type === "test") {
    return "Test message";
  }
  return type;
}

/**
 * GET /api/admin/notifications
 * Whether the Discord bot is set up, how many DMs went out / failed over the
 * last 7 days, and the 100 most recent, for the admin Notifications page.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [byStatus, recent] = await Promise.all([
      // How many notifications in the last 7 days are in each status
      prisma.notification.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: true }),
      prisma.notification.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          status: true,
          error: true,
          attempts: true,
          createdAt: true,
          sentAt: true,
          user: { select: { displayName: true } },
        },
      }),
    ]);

    return NextResponse.json({
      botConfigured: isDiscordConfigured(),
      // e.g. { sent: 42, failed: 1, expired: 3 }
      last7Days: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      // Each notification's fields, plus its type's readable name
      recent: recent.map((n) => ({ ...n, typeLabel: typeLabel(n.type) })),
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return NextResponse.json({ error: "Failed to load notifications" }, { status: 500 });
  }
}

/**
 * POST /api/admin/notifications
 * Sends the signed-in admin a test DM right away.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isDiscordConfigured()) {
      return NextResponse.json(
        { error: "The Discord bot isn't set up yet — add DISCORD_BOT_TOKEN to the server's env file and restart the site" },
        { status: 400 }
      );
    }

    // Queued like any other DM (the current time in the key makes each test unique),
    // then sent right away so the admin sees the result
    const id = await queueNotification(
      session.user.id,
      "test",
      `test:${Date.now()}`,
      {
        title: "Test message",
        body: "If you're reading this, MLE Fantasy can DM you. 🎉",
        url: siteUrl("/admin/notifications"),
      },
      { expiresAt: new Date(Date.now() + 10 * 60 * 1000) } // gives up after 10 minutes
    );
    if (!id) {
      return NextResponse.json({ error: "Couldn't queue the test message" }, { status: 500 });
    }

    const result = await sendNotificationNow(id);
    if (result.status === "sent") {
      return NextResponse.json({ success: true, message: "Sent — check your Discord DMs" });
    }

    // 502 = Discord (the upstream service) didn't accept it
    // "pending" means it hit a temporary error and is queued to retry; anything else means it gave up
    const error =
      result.status === "pending"
        ? `Discord didn't take it yet (${result.error ?? "will retry"}) — it'll retry automatically`
        : `Couldn't send it: ${result.error ?? result.status}`;
    return NextResponse.json({ error }, { status: 502 });
  } catch (error) {
    console.error("Error sending test notification:", error);
    return NextResponse.json({ error: "Failed to send test message" }, { status: 500 });
  }
}
