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
 *
 * A notification's status moves through:
 *   pending  -> waiting to be sent (or to be retried after a failure)
 *   sending  -> a sender has claimed it and is talking to Discord right now
 *   sent     -> delivered
 *   failed   -> gave up: the user can't be DMed, or it failed MAX_ATTEMPTS times
 *   expired  -> not sent before its expiresAt, so no longer worth sending
 */

// Every kind of DM the site sends. Users see the label and description in
// their notification settings; adminOnly types are only offered to admins.
// (`as const` makes TypeScript treat these names as the fixed list of valid types.)
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

/** One of the type names above, e.g. "trade_offer". */
export type NotificationType = keyof typeof NOTIFICATION_TYPES;

/** The admin types: every type whose name starts with "admin_" (admin_trade_review, admin_alert). */
type AdminNotificationType = Extract<NotificationType, `admin_${string}`>;

const HOUR_MS = 60 * 60 * 1000;
// A notification not sent within this long is dropped (unless the caller sets its own expiry)
const DEFAULT_LIFETIME_MS = 48 * HOUR_MS;
// Give up after this many failed tries
const MAX_ATTEMPTS = 5;
// A send that crashed mid-way (server restart) is retried after this long
const STUCK_SENDING_MS = 5 * 60 * 1000;
// Most notifications sent per 15-second run; any more wait for the next run
const MAX_SENDS_PER_RUN = 25;

/** Absolute link to a page on the site, for a DM's "Open" button. */
export function siteUrl(path: string): string {
  // AUTH_URL is the site's public address; strip any trailing "/" so we don't get "//path"
  const base = (process.env.AUTH_URL || "https://fantasy.mlesports.gg").replace(/\/+$/, "");
  return `${base}${path}`;
}

export interface NotificationMessage {
  title: string;
  body: string; // Discord formatting works here, e.g. **bold**
  url?: string; // page the "Open" button links to
}

/**
 * Queues one DM for a user, unless they've turned this type off. `key`
 * identifies the event (e.g. "trade-offer:<tradeId>"); together with the
 * user it's unique, so queueing the same event again is a no-op. Returns
 * the new notification's id, or null if it was skipped or already queued.
 * Never throws — a notification problem must never break the action that
 * caused it.
 *
 * Options:
 *   expiresAt - don't send after this time (default: 48 hours from now)
 *   sendNow   - also try to send it immediately, instead of waiting up to
 *               15 seconds for the background sender
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
    // Skip it if the user has turned this type off
    const setting = await prisma.notificationSetting.findUnique({
      where: { userId_type: { userId, type } },
    });
    if (setting && !setting.enabled) {
      return null;
    }

    const dedupeKey = `${key}:${userId}`;

    // createMany with skipDuplicates inserts the row only if no row with this
    // dedupeKey exists yet (the database enforces it's unique), instead of
    // throwing an error. count is 0 when it was already queued.
    const created = await prisma.notification.createMany({
      data: [
        {
          userId,
          type,
          dedupeKey,
          title: message.title,
          body: message.body,
          url: message.url ?? null,
          expiresAt: options.expiresAt ?? new Date(Date.now() + DEFAULT_LIFETIME_MS),
        },
      ],
      skipDuplicates: true,
    });
    if (created.count === 0) {
      return null;
    }

    // createMany doesn't return the new row, so look up its id
    const row = await prisma.notification.findUnique({
      where: { dedupeKey },
      select: { id: true },
    });
    if (!row) {
      return null;
    }

    if (options.sendNow) {
      // Deliberately not awaited: the caller (e.g. a draft pick) shouldn't
      // wait on Discord. If this attempt fails, the background sender retries.
      deliverNotification(row.id).catch((error) => console.error("[notifications] Immediate send failed:", error));
    }
    return row.id;
  } catch (error) {
    console.error(`[notifications] Couldn't queue ${type} for ${userId}:`, error);
    return null;
  }
}

/** Queues the same DM for every admin (each admin's own settings apply). */
export async function queueAdminNotification(
  type: AdminNotificationType,
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
  if (!isDiscordConfigured()) {
    return;
  }

  // The claim: a single update that only matches if the notification is still
  // pending, due, and not expired. The database applies it to at most one
  // caller, so if count is 0, someone else got it first (or it isn't due).
  const now = new Date();
  const claimed = await prisma.notification.updateMany({
    where: { id, status: "pending", sendAfter: { lte: now }, expiresAt: { gt: now } },
    // sendAfter doubles as "when this send started", for crash recovery in runNotificationSender
    data: { status: "sending", attempts: { increment: 1 }, sendAfter: now },
  });
  if (claimed.count === 0) {
    return;
  }

  // Load the message and the recipient's Discord user id
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
    const errorMessage = error instanceof Error ? error.message : String(error);
    // permanent = Discord says this user can't be DMed at all, so don't retry
    const permanent = error instanceof DiscordSendError && error.permanent;
    // attempts already includes this try (the claim above added 1)
    const outOfTries = notification.attempts >= MAX_ATTEMPTS;

    if (permanent || outOfTries) {
      await prisma.notification.update({
        where: { id },
        data: { status: "failed", error: errorMessage },
      });
      return;
    }

    // Put it back in the queue to retry later. Rate limits wait as long as
    // Discord asks; other errors wait longer after each failed try
    // (attempts² × 30 seconds: 30s, 2m, 4.5m, then 8m).
    let retryInMs = notification.attempts * notification.attempts * 30 * 1000;
    if (error instanceof DiscordSendError && error.retryAfterMs !== undefined) {
      retryInMs = error.retryAfterMs;
    }
    await prisma.notification.update({
      where: { id },
      data: { status: "pending", sendAfter: new Date(Date.now() + retryInMs), error: errorMessage },
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

  // 1. Expire anything past its expiresAt that hasn't gone out
  await prisma.notification.updateMany({
    where: { status: { in: ["pending", "sending"] }, expiresAt: { lte: now } },
    data: { status: "expired" },
  });
  if (!isDiscordConfigured()) {
    return;
  }

  // 2. A notification stuck in "sending" for over 5 minutes was interrupted
  //    (e.g. the server restarted mid-send), so put it back in the queue
  const stuckBefore = new Date(now.getTime() - STUCK_SENDING_MS);
  await prisma.notification.updateMany({
    where: { status: "sending", sendAfter: { lte: stuckBefore } },
    data: { status: "pending" },
  });

  // 3. Send what's due, oldest first, one at a time
  const due = await prisma.notification.findMany({
    where: { status: "pending", sendAfter: { lte: now } },
    orderBy: { createdAt: "asc" },
    take: MAX_SENDS_PER_RUN,
    select: { id: true },
  });
  for (const notification of due) {
    await deliverNotification(notification.id);
  }
}

/** Every type a user can see in their settings, with whether it's on. */
export async function getNotificationSettings(userId: string, isAdmin: boolean) {
  // Only types the user has changed have a row; a type with no row is on
  const rows = await prisma.notificationSetting.findMany({ where: { userId } });
  const enabledByType = new Map(rows.map((row) => [row.type, row.enabled]));

  // (Object.keys returns plain strings, so tell TypeScript they're type names)
  const allTypes = Object.keys(NOTIFICATION_TYPES) as NotificationType[];
  return allTypes
    .filter((type) => isAdmin || !NOTIFICATION_TYPES[type].adminOnly)
    .map((type) => ({
      type,
      label: NOTIFICATION_TYPES[type].label,
      description: NOTIFICATION_TYPES[type].description,
      adminOnly: NOTIFICATION_TYPES[type].adminOnly,
      enabled: enabledByType.get(type) ?? true,
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

  // Nothing has ever failed
  if (!lastFailure) {
    return null;
  }
  // Something was delivered after the failure, so whatever it was is fixed
  if (lastSent?.sentAt && lastSent.sentAt >= lastFailure.createdAt) {
    return null;
  }
  return lastFailure.error;
}

/** Turns one notification type on or off for a user (creating their setting row if needed). */
export async function setNotificationSetting(userId: string, type: NotificationType, enabled: boolean): Promise<void> {
  await prisma.notificationSetting.upsert({
    where: { userId_type: { userId, type } },
    update: { enabled },
    create: { userId, type, enabled },
  });
}

/** Checks that a value from a request is one of the notification type names above. */
export function isNotificationType(value: unknown): value is NotificationType {
  // Object.hasOwn, not `in`: `"toString" in NOTIFICATION_TYPES` would be true
  return typeof value === "string" && Object.hasOwn(NOTIFICATION_TYPES, value);
}

/** Seconds as words, for DMs: 45 -> "45 seconds", 120 -> "2 minutes", 90 -> "1 minute 30 seconds" */
export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (minutes > 0) {
    parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  }
  if (seconds > 0 || minutes === 0) {
    parts.push(`${seconds} second${seconds === 1 ? "" : "s"}`);
  }
  return parts.join(" ");
}
