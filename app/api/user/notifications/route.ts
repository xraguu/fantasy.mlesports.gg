import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  getDeliveryProblem,
  getNotificationSettings,
  isNotificationType,
  NOTIFICATION_TYPES,
  setNotificationSetting,
} from "@/lib/notifications";

/**
 * GET /api/user/notifications
 * The signed-in user's Discord DM settings (every type they can get, and
 * whether it's on), plus why their DMs aren't getting through, if they
 * aren't — usually because they're not in the MLE Discord or don't allow
 * DMs from its members.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } });
    const [settings, deliveryProblem] = await Promise.all([
      getNotificationSettings(session.user.id, user?.role === "admin"),
      getDeliveryProblem(session.user.id),
    ]);

    return NextResponse.json({ settings, deliveryProblem });
  } catch (error) {
    console.error("Error fetching notification settings:", error);
    return NextResponse.json({ error: "Failed to load notification settings" }, { status: 500 });
  }
}

/**
 * PUT /api/user/notifications
 * Body: { type, enabled } — turns one notification type on or off.
 */
export async function PUT(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { type, enabled } = await req.json();
    if (!isNotificationType(type) || typeof enabled !== "boolean") {
      return NextResponse.json({ error: "A valid type and enabled: true/false are required" }, { status: 400 });
    }
    if (NOTIFICATION_TYPES[type].adminOnly) {
      const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } });
      if (user?.role !== "admin") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }
    }

    await setNotificationSetting(session.user.id, type, enabled);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving notification setting:", error);
    return NextResponse.json({ error: "Failed to save notification setting" }, { status: 500 });
  }
}
