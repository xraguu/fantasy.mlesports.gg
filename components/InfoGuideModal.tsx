"use client";

import { useEffect, useState } from "react";

interface InfoGuideModalProps {
  open: boolean;
  onClose: () => void;
}

interface SprocketRatingRange {
  min: number;
  max: number;
  points: number;
}

interface ScoringRules {
  goals: number;
  shots: number;
  saves: number;
  assists: number;
  demosInflicted: number;
  demosTaken: number;
  sprocketRatingRanges: SprocketRatingRange[];
  gameWin: number;
  gameLoss: number;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: "1.75rem" }}>
      <h3
        style={{
          fontSize: "1.1rem",
          fontWeight: 700,
          color: "var(--accent)",
          marginBottom: "0.6rem",
        }}
      >
        {title}
      </h3>
      <div
        style={{
          fontSize: "0.92rem",
          color: "var(--text-main)",
          lineHeight: 1.7,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function ScoringDetailModal({ onClose }: { onClose: () => void }) {
  const [rules, setRules] = useState<ScoringRules | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/scoring-rules")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => setRules(data.rules))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const statRows: [string, number][] = rules
    ? [
        ["Goals", rules.goals],
        ["Shots", rules.shots],
        ["Saves", rules.saves],
        ["Assists", rules.assists],
        ["Demos Inflicted", rules.demosInflicted],
        ["Demos Taken", rules.demosTaken],
        ["Game Win", rules.gameWin],
        ["Game Loss", rules.gameLoss],
      ]
    : [];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2100,
        padding: "1.5rem",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-box modal-box-tight-padding"
        style={{
          maxWidth: "480px",
          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
          borderRadius: "12px",
          padding: "1.75rem",
          border: "1px solid rgba(255,255,255,0.15)",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.6)",
        }}
      >
        <div
          className="modal-box-header"
          style={{
            justifyContent: "space-between",
            alignItems: "center",
            gap: "0.75rem",
            marginBottom: "1.25rem",
          }}
        >
          <h2
            style={{
              fontSize: "clamp(1.05rem, 4.5vw, 1.3rem)",
              fontWeight: 700,
              color: "var(--text-main)",
              margin: 0,
            }}
          >
            Scoring Point Values
          </h2>
          <button
            onClick={onClose}
            style={{
              flexShrink: 0,
              background: "rgba(255, 255, 255, 0.1)",
              border: "none",
              color: "#ffffff",
              fontSize: "1.3rem",
              cursor: "pointer",
              padding: "0.2rem 0.55rem",
              lineHeight: 1,
              borderRadius: "4px",
            }}
          >
            ×
          </button>
        </div>

        {loading ? (
          <p style={{ color: "var(--text-muted)" }}>Loading...</p>
        ) : error || !rules ? (
          <p style={{ color: "var(--text-muted)" }}>
            Couldn&apos;t load current point values.
          </p>
        ) : (
          <>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                marginBottom: "1.5rem",
              }}
            >
              <tbody>
                {statRows.map(([label, value]) => (
                  <tr
                    key={label}
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
                  >
                    <td
                      style={{
                        padding: "0.5rem 0",
                        color: "var(--text-main)",
                        fontSize: "0.9rem",
                      }}
                    >
                      {label}
                    </td>
                    <td
                      style={{
                        padding: "0.5rem 0",
                        textAlign: "right",
                        fontWeight: 700,
                        fontSize: "0.9rem",
                        color: value < 0 ? "#ef4444" : "var(--accent)",
                      }}
                    >
                      {value > 0 ? "+" : ""}
                      {value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3
              style={{
                fontSize: "0.95rem",
                fontWeight: 700,
                color: "var(--accent)",
                marginBottom: "0.4rem",
              }}
            >
              Sprocket Rating Bonus
            </h3>
            <p
              style={{
                fontSize: "0.8rem",
                color: "var(--text-muted)",
                marginBottom: "0.6rem",
              }}
            >
              A flat bonus is added based on which range a team&apos;s Sprocket
              Rating falls into that week (not multiplied).
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr
                  style={{ borderBottom: "2px solid rgba(255,255,255,0.15)" }}
                >
                  <th
                    style={{
                      padding: "0.4rem 0",
                      textAlign: "left",
                      fontSize: "0.8rem",
                      color: "var(--text-muted)",
                    }}
                  >
                    SR Range
                  </th>
                  <th
                    style={{
                      padding: "0.4rem 0",
                      textAlign: "right",
                      fontSize: "0.8rem",
                      color: "var(--text-muted)",
                    }}
                  >
                    Bonus
                  </th>
                </tr>
              </thead>
              <tbody>
                {rules.sprocketRatingRanges.map((r, i) => (
                  <tr
                    key={i}
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
                  >
                    <td
                      style={{
                        padding: "0.5rem 0",
                        color: "var(--text-main)",
                        fontSize: "0.9rem",
                      }}
                    >
                      {r.min} – {r.max}
                    </td>
                    <td
                      style={{
                        padding: "0.5rem 0",
                        textAlign: "right",
                        fontWeight: 700,
                        fontSize: "0.9rem",
                        color: "var(--accent)",
                      }}
                    >
                      +{r.points}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

function WaiverSystemsModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2100,
        padding: "1.5rem",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-box modal-box-tight-padding"
        style={{
          maxWidth: "560px",
          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
          borderRadius: "12px",
          padding: "1.75rem",
          border: "1px solid rgba(255,255,255,0.15)",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.6)",
        }}
      >
        <div className="modal-box-header" style={{ justifyContent: "space-between", alignItems: "center", gap: "0.75rem", marginBottom: "1.25rem" }}>
          <h2 style={{ fontSize: "clamp(1.05rem, 4.5vw, 1.3rem)", fontWeight: 700, color: "var(--text-main)", margin: 0 }}>
            Waiver Systems
          </h2>
          <button
            onClick={onClose}
            style={{
              flexShrink: 0,
              background: "rgba(255, 255, 255, 0.1)",
              border: "none",
              color: "#ffffff",
              fontSize: "1.3rem",
              cursor: "pointer",
              padding: "0.2rem 0.55rem",
              lineHeight: 1,
              borderRadius: "4px",
            }}
          >
            ×
          </button>
        </div>

        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "1.25rem" }}>
          Your league admin picks one of these three when the league is created — check your league&apos;s
          settings to see which one applies to you.
        </p>

        <div style={{ marginBottom: "1.25rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--accent)", marginBottom: "0.4rem" }}>
            Fixed Order (Priority)
          </h3>
          <p style={{ fontSize: "0.88rem", color: "var(--text-main)", lineHeight: 1.6 }}>
            Managers start in a priority list based on reverse draft order (last pick gets priority #1).
            Successfully claiming a team sends you to the back of the line — but only on a
            <strong> successful</strong> claim; if you have no claims in, or the team you wanted goes to
            someone ahead of you, you keep your spot. Once a new week starts, the whole order resets to
            reverse current standings — the last-place team gets priority #1 for that week.
          </p>
        </div>

        <div style={{ marginBottom: "1.25rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--accent)", marginBottom: "0.4rem" }}>
            Rolling Waivers
          </h3>
          <p style={{ fontSize: "0.88rem", color: "var(--text-main)", lineHeight: 1.6 }}>
            Works exactly like Fixed Order — starts at reverse draft order, a successful claim sends you to
            the back of the line, and skipped/unused turns don&apos;t cost you your spot — except the order
            never resets. It just keeps rolling over week to week for the entire season, regardless of the
            standings.
          </p>
        </div>

        <div>
          <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--accent)", marginBottom: "0.4rem" }}>
            FAAB (Free Agent Acquisition Budget)
          </h3>
          <p style={{ fontSize: "0.88rem", color: "var(--text-main)", lineHeight: 1.6 }}>
            Every team gets a virtual budget for the whole season (set by your league admin). To claim a
            team on waivers, you place a secret bid — the highest bidder wins and that amount comes out of
            their budget. There&apos;s no priority order at all; every manager has an equal shot at every
            team, limited only by how much of their budget they&apos;re willing to spend.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function InfoGuideModal({ open, onClose }: InfoGuideModalProps) {
  const [showScoringDetail, setShowScoringDetail] = useState(false);
  const [showWaiverSystems, setShowWaiverSystems] = useState(false);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
        padding: "1.5rem",
      }}
    >
      {showScoringDetail && (
        <ScoringDetailModal onClose={() => setShowScoringDetail(false)} />
      )}
      {showWaiverSystems && (
        <WaiverSystemsModal onClose={() => setShowWaiverSystems(false)} />
      )}

      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-box modal-box-tight-padding"
        style={{
          maxWidth: "720px",
          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
          borderRadius: "12px",
          padding: "2rem",
          border: "1px solid rgba(255,255,255,0.15)",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
        }}
      >
        <div
          className="modal-box-header"
          style={{
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          <h2
            style={{
              fontSize: "clamp(1.2rem, 5vw, 1.6rem)",
              fontWeight: 700,
              color: "var(--text-main)",
              margin: 0,
            }}
          >
            League Guide
          </h2>
          <button
            onClick={onClose}
            style={{
              flexShrink: 0,
              background: "rgba(255, 255, 255, 0.1)",
              border: "none",
              color: "#ffffff",
              fontSize: "1.4rem",
              cursor: "pointer",
              padding: "0.25rem 0.6rem",
              lineHeight: 1,
              borderRadius: "4px",
            }}
          >
            ×
          </button>
        </div>

        <Section title="Your Roster">
          <p>
            Each fantasy team has 8 slots: two <strong>2s</strong>, two{" "}
            <strong>3s</strong>, one <strong>FLX</strong>, and three{" "}
            <strong>Bench</strong> spots. 2s/3s slots score only that
            mode&apos;s stats for the MLE team in them. FLX scores whichever
            mode (2s or 3s) that team scored higher in that week. Bench slots
            never count toward your weekly score, and never lock — you can
            always drop, trade, or pick up into the bench whenever you want.
          </p>
        </Section>

        <Section title="The Draft">
          <p>
            Before the season starts, managers draft MLE teams in the Draft Room
            (linked from the top of your league once a draft is open). Each pick
            has a countdown timer — if it expires without a pick, the server
            auto-drafts for you: first from your draft queue (set it up ahead of
            time in the Queue tab), or a random available team if your queue is
            empty. You can browse every available team&apos;s last-season stats,
            filtered by MLE league and mode, before picking. A draft can also be
            done outside of the site if wanted. Trades, waivers, and free-agent
            pickups are all disabled until the draft is complete.
          </p>
        </Section>

        <Section title="Regular Season & Lineup Locking">
          <p>
            Each week, your <strong>starting lineup</strong> (2s/3s/FLX — not
            bench) is scored against your opponent&apos;s. Lineups automatically
            lock at 3:00am ET on the first day of matches (Thursday), and unlock
            at 11:59pm ET on the last day of matches (Sunday) — so make your
            changes before the match weekend begins. Bench slots are the
            exception and never lock. Stats refresh automatically throughout the
            weekend as games are played, so your score updates live.
          </p>
        </Section>

        <Section title="Scoring">
          <p>
            Fantasy points come from each MLE team&apos;s match stats that week:
            goals, shots, saves, assists, demos inflicted/taken, their Sprocket
            Rating, and a bonus for series wins/losses. Leagues can also enable{" "}
            <strong>Double Win</strong>: on top of your head-to-head result, the
            top half of teams by score each week get a bonus win and the bottom
            half get a bonus loss.
          </p>
          <button
            onClick={() => setShowScoringDetail(true)}
            style={{
              marginTop: "0.5rem",
              padding: "0.5rem 1.1rem",
              background: "rgba(242, 182, 50, 0.15)",
              border: "1px solid rgba(242, 182, 50, 0.4)",
              borderRadius: "8px",
              color: "var(--accent)",
              fontWeight: 700,
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            View exact point values →
          </button>
        </Section>

        <Section title="Playoffs">
          <p>
            The regular season runs 7-8 weeks depending on league size, then the
            top seeds move on to a multi-week playoff bracket (seeded by
            regular-season standings) to decide final placements. Remaining
            teams play in a separate consolation bracket for the lower
            placements. Bracket matchups are generated automatically round by
            round as each week&apos;s scores come in.
          </p>
        </Section>

        <Section title="Trades">
          <p>
            Propose a trade with another manager from their team page. Once they
            accept, it doesn&apos;t execute immediately — there&apos;s a 12-hour
            window where a league admin can veto it. If nobody vetoes, it
            executes automatically. If a team in the trade becomes locked during
            that window, the trade is cancelled instead of going through. Trades
            stop being allowed once your league&apos;s playoffs begin.
          </p>
        </Section>

        <Section title="Waivers & Free Agents">
          <p>
            If a team is unrostered, you can pick it up instantly as a{" "}
            <strong>free agent</strong>. If it&apos;s currently on
            <strong>waivers</strong> (just dropped by another manager), you
            submit a waiver claim instead, which processes on your league&apos;s
            scheduled waiver day. A team dropped by a manager sits on waivers
            until the next processing run — if nobody claims it, it becomes a
            free agent. Your own pending waiver claims are visible only to you,
            on the Waivers tab of your roster page.
          </p>
          <button
            onClick={() => setShowWaiverSystems(true)}
            style={{
              marginTop: "0.5rem",
              padding: "0.5rem 1.1rem",
              background: "rgba(242, 182, 50, 0.15)",
              border: "1px solid rgba(242, 182, 50, 0.4)",
              borderRadius: "8px",
              color: "var(--accent)",
              fontWeight: 700,
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            How do the waiver systems work? →
          </button>
        </Section>

        <Section title="Where to find things">
          <p>
            <strong>My Roster</strong> — Your fantasy team, lineups, and waivers.{" "}<br></br>
            <strong>MLE Teams</strong> — Browse every MLE team and their season stats.<br></br> 
            <strong>Scoreboard</strong> — This week&apos;s matchups and results.{" "}<br></br>
            <strong>Standings</strong> — League standings and playoff bracket.{" "}<br></br>
            <strong>Opponents</strong> — Your opponents&apos; fantasy teams .
          </p>
        </Section>
      </div>
    </div>
  );
}
