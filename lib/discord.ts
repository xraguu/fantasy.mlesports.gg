/**
 * Minimal Discord bot client for sending DMs, over Discord's REST API (no
 * gateway connection or bot library needed just to send messages). The bot
 * token comes from DISCORD_BOT_TOKEN; it's the "Bot" token of the same
 * Discord application the site uses for sign-in.
 *
 * Discord only lets a bot DM someone who shares a server with it (the bot
 * has to be in the MLE Discord) and who allows DMs from that server's
 * members — otherwise sending fails with error 50007.
 */

const API = "https://discord.com/api/v10";
const GOLD = 0xf2b632;

export function isDiscordConfigured(): boolean {
  return !!process.env.DISCORD_BOT_TOKEN;
}

export class DiscordSendError extends Error {
  constructor(
    message: string,
    /** Won't work no matter how often it's retried (e.g. the user blocks DMs). */
    public readonly permanent: boolean,
    /** For rate limits: how long Discord asked us to wait. */
    public readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = "DiscordSendError";
  }
}

// Discord error codes that mean "this person can't be messaged"
const UNREACHABLE_CODES: Record<number, string> = {
  10013: "Unknown Discord user",
  50007: "Can't DM this user — they need to be in the MLE Discord and allow DMs from server members",
  50278: "Can't DM this user — they need to be in the MLE Discord and allow DMs from server members",
};

async function discordRequest<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (res.ok) return (await res.json()) as T;

  const data = (await res.json().catch(() => ({}))) as { code?: number; message?: string; retry_after?: number };
  if (res.status === 429) {
    throw new DiscordSendError("Rate limited by Discord", false, Math.ceil((data.retry_after ?? 5) * 1000));
  }
  if (data.code !== undefined && UNREACHABLE_CODES[data.code]) {
    throw new DiscordSendError(UNREACHABLE_CODES[data.code], true);
  }
  if (res.status === 401) {
    throw new DiscordSendError("Discord rejected the bot token — check DISCORD_BOT_TOKEN", false);
  }
  throw new DiscordSendError(`Discord error ${res.status}: ${data.message ?? "unknown"}`, false);
}

// DM channel id per Discord user, so each send is one request instead of two
const dmChannelCache = new Map<string, string>();

async function getDmChannelId(discordUserId: string): Promise<string> {
  const cached = dmChannelCache.get(discordUserId);
  if (cached) return cached;
  const channel = await discordRequest<{ id: string }>("/users/@me/channels", { recipient_id: discordUserId });
  dmChannelCache.set(discordUserId, channel.id);
  return channel.id;
}

/**
 * DMs a Discord user one boxed (embed) message, with an "Open" button
 * linking to `url` when given.
 */
export async function sendDiscordDm(
  discordUserId: string,
  message: { title: string; body: string; url?: string | null }
): Promise<void> {
  const channelId = await getDmChannelId(discordUserId);
  // Discord only accepts https links on buttons (a local http://localhost
  // link would be rejected), so anything else goes in the text instead
  const buttonUrl = message.url?.startsWith("https://") ? message.url : null;
  const body = message.url && !buttonUrl ? `${message.body}\n\n${message.url}` : message.body;
  await discordRequest(`/channels/${channelId}/messages`, {
    embeds: [
      {
        title: message.title.slice(0, 256),
        description: body.slice(0, 4000),
        color: GOLD,
        footer: { text: "MLE Fantasy · Turn these off under Notifications on the home page" },
      },
    ],
    components: buttonUrl
      ? [{ type: 1, components: [{ type: 2, style: 5, label: "Open", url: buttonUrl }] }]
      : [],
  });
}
