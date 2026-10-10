import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { formatDuration, queueAdminNotification, queueNotification, siteUrl } from "@/lib/notifications";
import { formatEasternDateTime } from "@/lib/timezone";

/**
 * Builds and queues the DM for each event the site notifies about. Every
 * function here swallows its own errors (logging them) — a notification
 * problem must never break the pick, trade, or claim that triggered it.
 */

async function safely(label: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(`[notifications] ${label} failed:`, error);
  }
}

/** MLE team id -> "AL Aviators" */
async function mleTeamLabels(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const teams = await prisma.mLETeam.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, name: true, leagueId: true },
  });
  return new Map(teams.map((t) => [t.id, `${t.leagueId} ${t.name}`]));
}

const teamList = (ids: string[], labels: Map<string, string>) =>
  ids.length > 0 ? ids.map((id) => `**${labels.get(id) ?? "Unknown team"}**`).join(", ") : "nothing";

const rosterUrl = (leagueId: string, fantasyTeamId: string, tab?: "trades" | "waivers") =>
  siteUrl(`/leagues/${leagueId}/my-roster/${fantasyTeamId}${tab ? `?tab=${tab}` : ""}`);

// ---------------------------------------------------------------------------
// Draft
// ---------------------------------------------------------------------------

/**
 * "You're on the clock" for whoever has the current pick, and "you're up
 * next" for the pick after it. Call whenever the current pick changes
 * (draft start, every pick, resume). Managers on autodraft are skipped —
 * their picks are made for them instantly.
 */
export async function notifyDraftClock(leagueId: string): Promise<void> {
  await safely("Draft clock", async () => {
    const league = await prisma.fantasyLeague.findUnique({
      where: { id: leagueId },
      select: { name: true, draftStatus: true, draftPickDeadline: true },
    });
    if (!league || league.draftStatus !== "in_progress" || !league.draftPickDeadline) return;
    const deadline = league.draftPickDeadline;

    const [current, next] = await prisma.draftPick.findMany({
      where: { fantasyLeagueId: leagueId, pickedAt: null },
      orderBy: { overallPick: "asc" },
      take: 2,
    });
    if (!current?.fantasyTeamId) return;

    const teams = await prisma.fantasyTeam.findMany({
      where: { id: { in: [current.fantasyTeamId, next?.fantasyTeamId].filter((id): id is string => !!id) } },
      select: { id: true, displayName: true, ownerUserId: true, autodraftEnabled: true },
    });
    const currentTeam = teams.find((t) => t.id === current.fantasyTeamId);
    const nextTeam = next ? teams.find((t) => t.id === next.fantasyTeamId) : undefined;
    const draftUrl = siteUrl(`/leagues/${leagueId}/draft`);

    if (currentTeam && !currentTeam.autodraftEnabled) {
      const secondsLeft = Math.max(0, Math.round((deadline.getTime() - Date.now()) / 1000));
      await queueNotification(
        currentTeam.ownerUserId,
        "draft_clock",
        // The deadline is part of the key so a paused-then-resumed draft
        // sends a fresh one
        `draft-clock:${current.id}:${deadline.getTime()}`,
        {
          title: "You're on the clock",
          body: `It's your pick in **${league.name}** — Round ${current.round}, Pick ${current.pickNumber}. You have ${formatDuration(secondsLeft)}.`,
          url: draftUrl,
        },
        { expiresAt: deadline, sendNow: true }
      );
    }

    // Skipped when it's the same manager back to back (a snake-draft turn)
    if (next && nextTeam && !nextTeam.autodraftEnabled && nextTeam.ownerUserId !== currentTeam?.ownerUserId) {
      await queueNotification(
        nextTeam.ownerUserId,
        "draft_on_deck",
        `draft-on-deck:${next.id}`,
        {
          title: "You're up next",
          body: `You pick after **${currentTeam?.displayName ?? "the current pick"}** in **${league.name}** — Round ${next.round}, Pick ${next.pickNumber}.`,
          url: draftUrl,
        },
        { expiresAt: deadline, sendNow: true }
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Leagues
// ---------------------------------------------------------------------------

export async function notifyLeagueAdded(fantasyTeamId: string): Promise<void> {
  await safely("League added", async () => {
    const team = await prisma.fantasyTeam.findUnique({
      where: { id: fantasyTeamId },
      select: { ownerUserId: true, displayName: true, fantasyLeagueId: true, league: { select: { name: true } } },
    });
    if (!team) return;
    await queueNotification(team.ownerUserId, "league_added", `league-added:${fantasyTeamId}`, {
      title: "You've been added to a league",
      body: `You're in **${team.league.name}** as **${team.displayName}**. Good luck!`,
      url: siteUrl(`/leagues/${team.fantasyLeagueId}`),
    });
  });
}

// ---------------------------------------------------------------------------
// Trades
// ---------------------------------------------------------------------------

async function loadTrade(tradeId: string) {
  return prisma.trade.findUnique({
    where: { id: tradeId },
    include: {
      league: { select: { name: true } },
      proposerTeam: { select: { id: true, displayName: true, ownerUserId: true } },
      receiverTeam: { select: { id: true, displayName: true, ownerUserId: true } },
    },
  });
}
type LoadedTrade = NonNullable<Awaited<ReturnType<typeof loadTrade>>>;

/** The trade as loaded before it's deleted, for notifyTradeWithdrawn. */
export const loadTradeForNotification = loadTrade;

export async function notifyTradeOffer(tradeId: string): Promise<void> {
  await safely("Trade offer", async () => {
    const trade = await loadTrade(tradeId);
    if (!trade) return;
    const labels = await mleTeamLabels([...trade.proposerGives, ...trade.receiverGives]);
    await queueNotification(trade.receiverUserId, "trade_offer", `trade-offer:${trade.id}`, {
      title: "New trade offer",
      body:
        `**${trade.proposerTeam.displayName}** offered you a trade in **${trade.league.name}**.\n` +
        `You get: ${teamList(trade.proposerGives, labels)}\n` +
        `You give: ${teamList(trade.receiverGives, labels)}`,
      url: rosterUrl(trade.fantasyLeagueId, trade.receiverTeamId, "trades"),
    });
  });
}

/** The receiver accepted: tell the proposer, and ask admins to review it. */
export async function notifyTradeAccepted(tradeId: string, vetoDeadline: Date): Promise<void> {
  await safely("Trade accepted", async () => {
    const trade = await loadTrade(tradeId);
    if (!trade) return;
    const when = formatEasternDateTime(vetoDeadline);
    await queueNotification(trade.proposerUserId, "trade_update", `trade-accepted:${trade.id}`, {
      title: "Trade accepted",
      body: `**${trade.receiverTeam.displayName}** accepted your trade in **${trade.league.name}**. It goes through ${when} unless an admin vetoes it.`,
      url: rosterUrl(trade.fantasyLeagueId, trade.proposerTeamId, "trades"),
    });

    const labels = await mleTeamLabels([
      ...trade.proposerGives,
      ...trade.receiverGives,
      ...trade.proposerDrops,
      ...trade.receiverDrops,
    ]);
    const drops = [
      trade.proposerDrops.length > 0 ? `${trade.proposerTeam.displayName} drops: ${teamList(trade.proposerDrops, labels)}` : null,
      trade.receiverDrops.length > 0 ? `${trade.receiverTeam.displayName} drops: ${teamList(trade.receiverDrops, labels)}` : null,
    ].filter(Boolean);
    await queueAdminNotification("admin_trade_review", `trade-review:${trade.id}`, {
      title: "Trade waiting for review",
      body:
        `In **${trade.league.name}**:\n` +
        `**${trade.proposerTeam.displayName}** gives ${teamList(trade.proposerGives, labels)}\n` +
        `**${trade.receiverTeam.displayName}** gives ${teamList(trade.receiverGives, labels)}\n` +
        (drops.length > 0 ? `${drops.join("\n")}\n` : "") +
        `It goes through ${when} unless you veto it.`,
      url: siteUrl("/admin/waivers"),
    });
  });
}

export async function notifyTradeRejected(tradeId: string): Promise<void> {
  await safely("Trade rejected", async () => {
    const trade = await loadTrade(tradeId);
    if (!trade) return;
    await queueNotification(trade.proposerUserId, "trade_update", `trade-rejected:${trade.id}`, {
      title: "Trade turned down",
      body: `**${trade.receiverTeam.displayName}** turned down your trade offer in **${trade.league.name}**.`,
      url: rosterUrl(trade.fantasyLeagueId, trade.proposerTeamId, "trades"),
    });
  });
}

/** The proposer withdrew a pending offer (the trade row is deleted, so pass it in). */
export async function notifyTradeWithdrawn(trade: LoadedTrade): Promise<void> {
  await safely("Trade withdrawn", async () => {
    await queueNotification(trade.receiverUserId, "trade_update", `trade-withdrawn:${trade.id}`, {
      title: "Trade offer withdrawn",
      body: `**${trade.proposerTeam.displayName}** withdrew their trade offer in **${trade.league.name}**.`,
      url: rosterUrl(trade.fantasyLeagueId, trade.receiverTeamId, "trades"),
    });
  });
}

/** Tells both sides of a trade the same news, each linked to their own roster. */
async function notifyBothSides(
  trade: LoadedTrade,
  key: string,
  title: string,
  body: (partnerName: string) => string
): Promise<void> {
  const sides = [
    { userId: trade.proposerUserId, teamId: trade.proposerTeamId, partner: trade.receiverTeam.displayName },
    { userId: trade.receiverUserId, teamId: trade.receiverTeamId, partner: trade.proposerTeam.displayName },
  ];
  for (const side of sides) {
    await queueNotification(side.userId, "trade_update", key, {
      title,
      body: body(side.partner),
      url: rosterUrl(trade.fantasyLeagueId, side.teamId, "trades"),
    });
  }
}

export async function notifyTradeVetoed(tradeId: string, reason?: string | null): Promise<void> {
  await safely("Trade vetoed", async () => {
    const trade = await loadTrade(tradeId);
    if (!trade) return;
    await notifyBothSides(trade, `trade-vetoed:${trade.id}`, "Trade vetoed", (partner) =>
      `An admin vetoed your trade with **${partner}** in **${trade.league.name}**.${reason ? `\nReason: ${reason}` : ""}`
    );
  });
}

/** `reason` is the trade history's reason, e.g. "Cancelled — a team involved became locked..." */
export async function notifyTradeCancelled(tradeId: string, reason: string): Promise<void> {
  await safely("Trade cancelled", async () => {
    const trade = await loadTrade(tradeId);
    if (!trade) return;
    const detail = reason.replace(/^Cancelled\s*[—-]\s*/, "").replace(/\.$/, "");
    await notifyBothSides(trade, `trade-cancelled:${trade.id}`, "Trade cancelled", (partner) =>
      `Your trade with **${partner}** in **${trade.league.name}** was cancelled — ${detail}.`
    );
  });
}

export async function notifyTradeCompleted(tradeId: string, processedEarly: boolean): Promise<void> {
  await safely("Trade completed", async () => {
    const trade = await loadTrade(tradeId);
    if (!trade) return;
    const labels = await mleTeamLabels([...trade.proposerGives, ...trade.receiverGives]);
    const early = processedEarly ? "\nIt went through early because matches started before its veto window ended." : "";
    const sides = [
      { userId: trade.proposerUserId, teamId: trade.proposerTeamId, partner: trade.receiverTeam.displayName, got: trade.receiverGives, gave: trade.proposerGives },
      { userId: trade.receiverUserId, teamId: trade.receiverTeamId, partner: trade.proposerTeam.displayName, got: trade.proposerGives, gave: trade.receiverGives },
    ];
    for (const side of sides) {
      await queueNotification(side.userId, "trade_update", `trade-completed:${trade.id}`, {
        title: "Trade complete",
        body:
          `Your trade with **${side.partner}** in **${trade.league.name}** went through.\n` +
          `You got: ${teamList(side.got, labels)}\n` +
          `You gave: ${teamList(side.gave, labels)}${early}`,
        url: rosterUrl(trade.fantasyLeagueId, side.teamId),
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Waivers
// ---------------------------------------------------------------------------

/**
 * One DM per manager for a waiver run, listing each of their claims'
 * results. Pass the ids of every claim the run looked at; ones still
 * pending (not processed) are ignored. `cause` "admin_change" is for claims
 * cancelled because an admin edited a roster, not by a waiver run.
 */
export async function notifyWaiverResults(
  claimIds: string[],
  cause: "waiver_run" | "admin_change" = "waiver_run"
): Promise<void> {
  await safely("Waiver results", async () => {
    if (claimIds.length === 0) return;
    const claims = await prisma.waiverClaim.findMany({
      where: { id: { in: claimIds }, status: { not: "pending" } },
      include: {
        fantasyTeam: { select: { id: true, ownerUserId: true, fantasyLeagueId: true, league: { select: { name: true } } } },
      },
      orderBy: { createdAt: "asc" },
    });
    if (claims.length === 0) return;

    const reasons = new Map(
      (
        await prisma.transaction.findMany({
          where: { waiverClaimId: { in: claims.map((c) => c.id) } },
          select: { waiverClaimId: true, reason: true },
        })
      ).map((t) => [t.waiverClaimId, t.reason])
    );
    const labels = await mleTeamLabels(claims.flatMap((c) => [c.addTeamId, c.dropTeamId].filter((id): id is string => !!id)));

    const byTeam = new Map<string, typeof claims>();
    for (const claim of claims) {
      if (!byTeam.has(claim.fantasyTeamId)) byTeam.set(claim.fantasyTeamId, []);
      byTeam.get(claim.fantasyTeamId)!.push(claim);
    }

    for (const [teamId, teamClaims] of byTeam) {
      const team = teamClaims[0].fantasyTeam;
      const lines = teamClaims.map((claim) => {
        const add = labels.get(claim.addTeamId) ?? "Unknown team";
        if (claim.status === "approved") {
          const drop = claim.dropTeamId ? `, dropped **${labels.get(claim.dropTeamId) ?? "Unknown team"}**` : "";
          const bid = claim.faabBid ? ` for $${claim.faabBid}` : "";
          return `✅ Added **${add}**${drop}${bid}`;
        }
        const reason = reasons.get(claim.id);
        return `❌ **${add}**${reason ? ` — ${reason}` : ""}`;
      });
      // Keyed by exactly which claims were reported, so a run is never reported twice
      const runKey = createHash("sha1").update(teamClaims.map((c) => c.id).sort().join(",")).digest("hex").slice(0, 16);
      await queueNotification(team.ownerUserId, "waiver_results", `waiver-results:${teamId}:${runKey}`, {
        title: cause === "admin_change" ? "Waiver claims cancelled" : "Waiver results",
        body:
          cause === "admin_change"
            ? `An admin changed a roster in **${team.league.name}**, so these claims were cancelled:\n${lines.join("\n")}`
            : `Waivers ran in **${team.league.name}**:\n${lines.join("\n")}`,
        url: rosterUrl(team.fantasyLeagueId, teamId, "waivers"),
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Admin alerts
// ---------------------------------------------------------------------------

export async function notifyAdminsStatsRefreshFailed(error: string): Promise<void> {
  await queueAdminNotification("admin_alert", `stats-refresh-failed:${Date.now()}`, {
    title: "Stats refresh failed",
    body: `The automatic stats refresh failed:\n${error}\n\nYou'll get one of these when it starts failing, not on every retry. The Database page shows its latest result.`,
    url: siteUrl("/admin/database"),
  });
}
