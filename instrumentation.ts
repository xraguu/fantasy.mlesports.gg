/**
 * Runs once when the Next.js server process boots (see
 * https://nextjs.org/docs/app/guides/instrumentation). This app runs as a
 * single long-lived Docker container on a droplet (not Vercel), so there's
 * no external cron platform to schedule the stats refresh — this in-process
 * timer is that schedule instead.
 */

declare global {
  var __statsRefreshScheduled: boolean | undefined;
  var __draftSweepScheduled: boolean | undefined;
}

const REFRESH_INTERVAL_MS = 120 * 60 * 1000; // every 120 minutes
const STARTUP_DELAY_MS = 30 * 1000; // let the server finish booting first
const DRAFT_SWEEP_INTERVAL_MS = 10 * 1000; // every 10 seconds

export async function register() {
  // Only run in the actual Node.js server runtime — not the edge runtime,
  // and not during `next build`. Also guarded against double-registration,
  // since dev-mode hot reload can call register() more than once.
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  if (!globalThis.__statsRefreshScheduled) {
    globalThis.__statsRefreshScheduled = true;

    const { runStatsRefresh } = await import("@/lib/statsRefresh");
    const { runAutoLockSweep } = await import("@/lib/autoLock");

    const refresh = async () => {
      try {
        // Every league's own currentWeek/lock state/roster carry-forward is
        // otherwise only ever advanced lazily, from that specific league's
        // own roster/scoreboard routes — a league nobody has opened since a
        // week boundary passed just sits stuck on its old week forever (no
        // carried-forward roster rows, so nothing to score), same class of
        // bug the draft autopick sweep below already exists to avoid. Run
        // it globally (no leagueId) here so every league stays current
        // regardless of whether anyone's actively browsing it.
        await runAutoLockSweep();
      } catch (error) {
        console.error("[stats-refresh] Scheduled auto-lock sweep failed:", error);
      }

      try {
        const result = await runStatsRefresh();
        console.log(
          `[stats-refresh] Refreshed season ${result.season} week ${result.week}: ` +
            `${result.import.imported} team(s) imported, ${result.calculate.slotsScored} slot(s) scored.`
        );
      } catch (error) {
        console.error("[stats-refresh] Scheduled refresh failed:", error);
      }
    };

    setTimeout(() => {
      refresh();
      setInterval(refresh, REFRESH_INTERVAL_MS);
    }, STARTUP_DELAY_MS);
  }

  if (!globalThis.__draftSweepScheduled) {
    globalThis.__draftSweepScheduled = true;

    // Enforces draft pick timers independent of whether anyone has the
    // draft room open — without this, a pick's deadline just sits expired
    // forever until someone happens to load the page again, since the only
    // other trigger is that page's own polling.
    const { runDraftAutopickSweep } = await import("@/lib/draftAutopick");

    setInterval(async () => {
      try {
        await runDraftAutopickSweep();
      } catch (error) {
        console.error("[draft-sweep] Scheduled sweep failed:", error);
      }
    }, DRAFT_SWEEP_INTERVAL_MS);
  }
}
