import { prisma } from "@/lib/prisma";
import { DiscordSendError, isDiscordConfigured, sendDiscordDm } from "@/lib/discord";

/**
 * Discord DM notifications. Every message is saved to the Notification
 * table first (queueNotification), then delivered by the background sender
 * (runNotificationSender, every 15 seconds from instrumentation.ts) — so a
 * restart never loses one, failures retry, and the unique dedupeKey means
 * the same event never DMs the same person twice, however many times the
 * code path that noticed it runs. Time-critical types (the draft clock)
 * also get an immediate delivery attempt.
 *
 * Notifications are on by default; a NotificationSetting row with
 * enabled=false turns one type off for one user.
 */

export const NOTIFICATION_TYPES = {
  draft_clock: { label: "You're on the clock", description: "When it's your turn to pick in a draft", adminOnly: false },
  draft_on_deck: { label: "You're up next", description: "When your draft pick is next", adminOnly: false },
  league_added: { label: "Added to a league", description: "When you're added to a league", adminOnly: false },
  trade_offer: { label: "Trade offers", description: "When someone offers you a trade", adminOnly: false },
  trade_update: {
    label: "Trade updates",
    description: "When your trade is accepted, turned down, withdrawn, vetoed, cancelled, or goes through",
    adminOnly: false,
  },
  waiver_results: { label: "Waiver results", description: "Your claims' results after each waiver run", adminOnly: false },
  lineup_reminder: {
    label: "Lineup reminders",
    description: "About a day before lineups lock, if you have empty starting slots",
    adminOnly: false,
  },
  weekly_result: { label: "Weekly results", description: "Your matchup result once each week is final", adminOnly: false },
  admin_trade_review: {
    label: "Trades to review",
    description: "When a trade is accepted and waiting out its veto window",
    adminOnly: true,
  },
  admin_alert: {
    label: "Problems to check",
    description: "Failed stats refreshes, overdue waiver claims, and unscored matchups",
    adminOnly: true,
  },
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_LIFETIME_MS = 48 * HOUR_MS;
const MAX_ATTEMPTS = 5;
// A send that crashed mid-way (server restart) is retried after this long
const STUCK_SENDING_MS = 5 * 60 * 1000;

/** Absolute link to a page on the site, for a DM's "Open" button. */
export function siteUrl(path: string): string {
  const base = (process.env.AUTH_URL || "https://fantasy.mlesports.gg").replace(/\/+$/, "");
  return `${base}${path}`;
}

export interface NotificationMessage {
  title: string;
  body: string;
  url?: string;
}

/**
 * Queues one DM for a user, unless they've turned this type off. `key`
 * identifies the event (e.g. "trade-offer:<tradeId>"); together with the
 * user it's unique, so queueing the same event again is a no-op. Returns
 * the new notification's id, or null if it was skipped or already queued.
 * Never throws — a notification problem must never break the action that
 * caused it.
 */
export async function queueNotification(
  userId: string,
  // "test" is the admin page's test message, which no setting turns off
  type: NotificationType | "test",
  key: string,
  message: NotificationMessage,
  options: { expiresAt?: Date; sendNow?: boolean } = {}
): Promise<string | null> {
  try {
    const setting = await prisma.notificationSetting.findUnique({
      where: { userId_type: { userId, type } },
    });
    if (setting && !setting.enabled) return null;

    const created = await prisma.notification.createMany({
      data: [
        {
          userId,
          type,
          dedupeKey: `${key}:${userId}`,
          title: message.title,
          body: message.body,
          url: message.url ?? null,
          expiresAt: options.expiresAt ?? new Date(Date.now() + DEFAULT_LIFETIME_MS),
        },
      ],
      skipDuplicates: true,
    });
    if (created.count === 0) return null;

    const row = await prisma.notification.findUnique({
      where: { dedupeKey: `${key}:${userId}` },
      select: { id: true },
    });
    if (row && options.sendNow) {
      // Not awaited: the caller (e.g. a draft pick) shouldn't wait on Discord
      void deliverNotification(row.id).catch((error) =>
        console.error("[notifications] Immediate send failed:", error)
      );
    }
    return row?.id ?? null;
  } catch (error) {
    console.error(`[notifications] Couldn't queue ${type} for ${userId}:`, error);
    return null;
  }
}

/** Queues the same DM for every admin (each admin's own settings apply). */
export async function queueAdminNotification(
  type: Extract<NotificationType, `admin_${string}`>,
  key: string,
  message: NotificationMessage
): Promise<void> {
  try {
    const admins = await prisma.user.findMany({ where: { role: "admin", status: "active" }, select: { id: true } });
    for (const admin of admins) {
      await queueNotification(admin.id, type, key, message);
    }
  } catch (error) {
    console.error(`[notifications] Couldn't queue ${type} for admins:`, error);
  }
}

/**
 * Sends one queued notification. Claims it first (pending -> sending), so
 * two senders running at once (the 15-second sweep and an immediate send)
 * can never both deliver it.
 */
async function deliverNotification(id: string): Promise<void> {
  if (!isDiscordConfigured()) return;

  const now = new Date();
  const claimed = await prisma.notification.updateMany({
    where: { id, status: "pending", sendAfter: { lte: now }, expiresAt: { gt: now } },
    // sendAfter doubles as "when this send started", for crash recovery below
    data: { status: "sending", attempts: { increment: 1 }, sendAfter: now },
  });
  if (claimed.count === 0) return;

  const notification = await prisma.notification.findUniqueOrThrow({
    where: { id },
    include: { user: { select: { discordId: true } } },
  });

  try {
    await sendDiscordDm(notification.user.discordId, notification);
    await prisma.notification.update({
      where: { id },
      data: { status: "sent", sentAt: new Date(), error: null },
    });
  } catch (error) {
    const permanent = error instanceof DiscordSendError && error.permanent;
    const outOfTries = notification.attempts >= MAX_ATTEMPTS;
    // Rate limits wait as long as Discord asks; other errors back off
    // 30s, 2m, 4.5m, 8m between tries
    const retryInMs =
      error instanceof DiscordSendError && error.retryAfterMs !== undefined
        ? error.retryAfterMs
        : notification.attempts * notification.attempts * 30 * 1000;
    await prisma.notification.update({
      where: { id },
      data:
        permanent || outOfTries
          ? { status: "failed", error: error instanceof Error ? error.message : String(error) }
          : {
              status: "pending",
              sendAfter: new Date(Date.now() + retryInMs),
              error: error instanceof Error ? error.message : String(error),
            },
    });
  }
}

/** Delivers one queued notification now and reports how it went (for the admin test button). */
export async function sendNotificationNow(id: string): Promise<{ status: string; error: string | null }> {
  await deliverNotification(id);
  const row = await prisma.notification.findUnique({ where: { id }, select: { status: true, error: true } });
  return { status: row?.status ?? "missing", error: row?.error ?? null };
}

/**
 * The background sender: expires notifications that are too old to be
 * useful, recovers sends interrupted by a restart, and delivers what's due.
 * Does nothing until the bot token is configured — notifications queued
 * before then just expire, instead of all arriving at once later.
 */
export async function runNotificationSender(): Promise<void> {
  const now = new Date();
  await prisma.notification.updateMany({
    where: { status: { in: ["pending", "sending"] }, expiresAt: { lte: now } },
    data: { status: "expired" },
  });
  if (!isDiscordConfigured()) return;

  await prisma.notification.updateMany({
    where: { status: "sending", sendAfter: { lte: new Date(now.getTime() - STUCK_SENDING_MS) } },
    data: { status: "pending" },
  });

  const due = await prisma.notification.findMany({
    where: { status: "pending", sendAfter: { lte: now } },
    orderBy: { createdAt: "asc" },
    take: 25,
    select: { id: true },
  });
  for (const { id } of due) {
    await deliverNotification(id);
  }
}

/** Every type a user can see in their settings, with whether it's on. */
export async function getNotificationSettings(userId: string, isAdmin: boolean) {
  const rows = await prisma.notificationSetting.findMany({ where: { userId } });
  const enabled = new Map(rows.map((r) => [r.type, r.enabled]));
  return (Object.entries(NOTIFICATION_TYPES) as [NotificationType, (typeof NOTIFICATION_TYPES)[NotificationType]][])
    .filter(([, info]) => isAdmin || !info.adminOnly)
    .map(([type, info]) => ({
      type,
      label: info.label,
      description: info.description,
      adminOnly: info.adminOnly,
      enabled: enabled.get(type) ?? true,
    }));
}

/**
 * Why a user's DMs aren't getting through (usually: not in the MLE Discord,
 * or DMs from its members turned off) — the latest failure's error, as long
 * as nothing has been delivered to them since. Null when there's no problem.
 */
export async function getDeliveryProblem(userId: string): Promise<string | null> {
  const [lastFailure, lastSent] = await Promise.all([
    prisma.notification.findFirst({
      where: { userId, status: "failed" },
      orderBy: { createdAt: "desc" },
      select: { error: true, createdAt: true },
    }),
    prisma.notification.findFirst({
      where: { userId, status: "sent" },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    }),
  ]);
  if (!lastFailure) return null;
  return !lastSent?.sentAt || lastSent.sentAt < lastFailure.createdAt ? lastFailure.error : null;
}

export async function setNotificationSetting(userId: string, type: NotificationType, enabled: boolean): Promise<void> {
  await prisma.notificationSetting.upsert({
    where: { userId_type: { userId, type } },
    update: { enabled },
    create: { userId, type, enabled },
  });
}

export function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === "string" && value in NOTIFICATION_TYPES;
}

/** "90 seconds", "2 minutes", "1 minute 30 seconds" */
export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  if (seconds > 0 || minutes === 0) parts.push(`${seconds} second${seconds === 1 ? "" : "s"}`);
  return parts.join(" ");
}
