import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAdminActivity } from "@/lib/adminActivity";
import {
  getDeliveryProblem,
  getNotificationSettings,
  isNotificationType,
  NOTIFICATION_TYPES,
  setNotificationSetting,
} from "@/lib/notifications";

/**
 * GET /api/admin/users/[userId]/notifications
 * Another user's Discord DM settings, for the bell on the admin Manage Users
 * page — the same list they see themselves (admin-only types included only
 * when they're an admin), plus why their DMs aren't getting through, if so.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId } = await params;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const [settings, deliveryProblem] = await Promise.all([
      getNotificationSettings(userId, user.role === "admin"),
      getDeliveryProblem(userId),
    ]);
    return NextResponse.json({ settings, deliveryProblem });
  } catch (error) {
    console.error("Error fetching user's notification settings:", error);
    return NextResponse.json({ error: "Failed to load notification settings" }, { status: 500 });
  }
}

/**
 * PUT /api/admin/users/[userId]/notifications
 * Body: { type, enabled } — turns one of that user's notification types on
 * or off (they can still change it back themselves).
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId } = await params;
    const { type, enabled } = await req.json();
    if (!isNotificationType(type) || typeof enabled !== "boolean") {
      return NextResponse.json({ error: "A valid type and enabled: true/false are required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, displayName: true } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (NOTIFICATION_TYPES[type].adminOnly && user.role !== "admin") {
      return NextResponse.json({ error: "That notification type is only for admins" }, { status: 400 });
    }

    await setNotificationSetting(userId, type, enabled);

    await logAdminActivity({
      adminUserId: session.user.id!,
      action: "user.notifications",
      description: `Turned ${enabled ? "on" : "off"} "${NOTIFICATION_TYPES[type].label}" notifications for "${user.displayName}"`,
      targetType: "User",
      targetId: userId,
      metadata: { type, enabled },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving user's notification setting:", error);
    return NextResponse.json({ error: "Failed to save notification setting" }, { status: 500 });
  }
}
