import { prisma } from "@/lib/prisma";

interface LogAdminActivityInput {
  adminUserId: string;
  action: string;
  description: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

export async function logAdminActivity(input: LogAdminActivityInput): Promise<void> {
  try {
    await prisma.adminActivityLog.create({
      data: {
        adminUserId: input.adminUserId,
        action: input.action,
        description: input.description,
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: input.metadata as any,
      },
    });
  } catch (error) {
    console.error("Failed to log admin activity:", error);
  }
}
