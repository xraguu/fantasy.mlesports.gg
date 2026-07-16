import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAdminActivity } from "@/lib/adminActivity";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await auth();

  // Check if user is authenticated and is an admin
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { userId } = await params;
    const body = await req.json();
    const { status, role } = body;

    // Prepare data to update
    const updateData: { status?: string; role?: string } = {};

    // Validate and add status if provided
    if (status) {
      if (!["active", "suspended"].includes(status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      updateData.status = status;
    }

    // Validate and add role if provided
    if (role) {
      if (!["admin", "user"].includes(role)) {
        return NextResponse.json({ error: "Invalid role" }, { status: 400 });
      }
      updateData.role = role;
    }

    // Check if there's anything to update
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    // Update user
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    const changeDescriptions: string[] = [];
    if (updateData.role) changeDescriptions.push(`role -> ${updateData.role}`);
    if (updateData.status) changeDescriptions.push(`status -> ${updateData.status}`);

    await logAdminActivity({
      adminUserId: session.user.id!,
      action: "user.update",
      description: `Updated user "${updatedUser.displayName}" (${changeDescriptions.join(", ")})`,
      targetType: "User",
      targetId: userId,
      metadata: updateData,
    });

    return NextResponse.json(updatedUser);
  } catch (error) {
    console.error("Error updating user:", error);
    return NextResponse.json(
      { error: "Failed to update user" },
      { status: 500 }
    );
  }
}
