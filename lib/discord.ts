/**
 * Minimal Discord bot client for sending DMs, over Discord's REST API (no
 * gateway connection or bot library needed just to send messages). The bot
 * token comes from DISCORD_BOT_TOKEN; it's the "Bot" token of the same
 * Discord application the site uses for sign-in.
 *
 * Discord only lets a bot DM someone who shares a server with it (the bot
 * has to be in the MLE Discord) and who allows DMs from that server's
 * members — otherwise sending fails with error 50007.
 *
 * This is the only file that talks to Discord. Everything else goes through
 * lib/notifications.ts, which queues messages and calls sendDiscordDm().
 */

const API = "https://discord.com/api/v10";

// Color of the stripe down the left side of each DM (MLE gold), as a hex number
const GOLD = 0xf2b632;

// Discord's size limits for a message "embed" (the boxed message format).
// The description limit is really 4096; 4000 leaves some headroom.
const MAX_TITLE_LENGTH = 256;
const MAX_DESCRIPTION_LENGTH = 4000;

// Discord identifies message components by number, not name
// (https://discord.com/developers/docs/interactions/message-components)
const COMPONENT_ACTION_ROW = 1; // a row that holds buttons
const COMPONENT_BUTTON = 2;
const BUTTON_STYLE_LINK = 5; // a button that just opens a URL

/**
 * Makes text that people typed (team names, league names) show exactly as
 * typed in a DM. Discord reads DM text as formatting: `*` and `_` make
 * italics, `[text](address)` makes a disguised link, `<@id>` a mention, and
 * so on. A backslash before each of those characters makes Discord show the
 * character itself instead, e.g. "[Click](x.co)" -> "\[Click\]\(x.co\)".
 * Text the code writes itself (like the ** around names) is not escaped.
 */
export function escapeDiscordMarkdown(text: string): string {
  return text.replace(/[\\*_~`|[\]()<>#:]/g, "\\$&");
}

/** True once the bot token is set on the server. Until then, nothing is sent. */
export function isDiscordConfigured(): boolean {
  return Boolean(process.env.DISCORD_BOT_TOKEN);
}

/**
 * Thrown when Discord refuses a message. The sender (lib/notifications.ts)
 * uses `permanent` and `retryAfterMs` to decide whether and when to retry.
 */
export class DiscordSendError extends Error {
  /** Won't work no matter how often it's retried (e.g. the user blocks DMs). */
  public readonly permanent: boolean;
  /** For rate limits: how long Discord asked us to wait. */
  public readonly retryAfterMs?: number;

  constructor(message: string, permanent: boolean, retryAfterMs?: number) {
    super(message);
    this.name = "DiscordSendError";
    this.permanent = permanent;
    this.retryAfterMs = retryAfterMs;
  }
}

// Discord error codes that mean "this person can't be messaged", so retrying
// is pointless (https://discord.com/developers/docs/topics/opcodes-and-status-codes)
const UNREACHABLE_CODES: Record<number, string> = {
  10013: "Unknown Discord user",
  50007: "Can't DM this user — they need to be in the MLE Discord and allow DMs from server members",
  50278: "Can't DM this user — they need to be in the MLE Discord and allow DMs from server members",
};

/** The fields Discord includes in an error response. */
interface DiscordErrorBody {
  code?: number; // Discord's own error code, e.g. 50007
  message?: string;
  retry_after?: number; // rate limits only: seconds to wait
}

/**
 * Sends one POST request to Discord's API, authenticated as the bot.
 * Returns Discord's JSON response, or throws a DiscordSendError describing
 * why it failed.
 */
async function discordRequest<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    return (await res.json()) as T;
  }

  // Read Discord's error details. If the response isn't valid JSON, carry on
  // with no details rather than failing here.
  let error: DiscordErrorBody = {};
  try {
    error = (await res.json()) as DiscordErrorBody;
  } catch {
    // Leave `error` empty
  }

  // 429 = too many requests. Discord says how long to wait; assume 5 seconds if it doesn't.
  if (res.status === 429) {
    const waitSeconds = error.retry_after ?? 5;
    throw new DiscordSendError("Rate limited by Discord", false, Math.ceil(waitSeconds * 1000));
  }
  if (error.code !== undefined && UNREACHABLE_CODES[error.code]) {
    throw new DiscordSendError(UNREACHABLE_CODES[error.code], true);
  }
  // 401 = unauthorized: the bot token is wrong or was reset
  if (res.status === 401) {
    throw new DiscordSendError("Discord rejected the bot token — check DISCORD_BOT_TOKEN", false);
  }
  throw new DiscordSendError(`Discord error ${res.status}: ${error.message ?? "unknown"}`, false);
}

// Before a bot can DM someone, it has to open a DM channel with them, which is
// a separate request. This remembers each user's channel id (in memory, until
// the server restarts) so later messages to them need only one request.
const dmChannelCache = new Map<string, string>();

async function getDmChannelId(discordUserId: string): Promise<string> {
  const cached = dmChannelCache.get(discordUserId);
  if (cached) {
    return cached;
  }
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
  // link would be rejected), so any other link goes at the end of the text
  // instead of on a button.
  let buttonUrl: string | null = null;
  let text = message.body;
  if (message.url?.startsWith("https://")) {
    buttonUrl = message.url;
  } else if (message.url) {
    text = `${message.body}\n\n${message.url}`;
  }

  // One row holding one link button, or no buttons at all
  const buttons = buttonUrl
    ? [
        {
          type: COMPONENT_ACTION_ROW,
          components: [{ type: COMPONENT_BUTTON, style: BUTTON_STYLE_LINK, label: "Open", url: buttonUrl }],
        },
      ]
    : [];

  await discordRequest(`/channels/${channelId}/messages`, {
    embeds: [
      {
        // Cut to Discord's limits, so an unusually long message is shortened rather than rejected
        title: message.title.slice(0, MAX_TITLE_LENGTH),
        description: text.slice(0, MAX_DESCRIPTION_LENGTH),
        color: GOLD,
        footer: { text: "MLE Fantasy · Turn these off under Notifications on the home page" },
      },
    ],
    components: buttons,
  });
}
