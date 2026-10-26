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
  goalsAgainst: number;
  shots: number;
  shotsAgainst: number;
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
          display: "flex",
          flexDirection: "column",
          gap: "0.6rem",
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

/** The gold "… →" button that opens a detail popup from a section. */
function DetailButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        alignSelf: "flex-start",
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
      {children}
    </button>
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

  // Every scoring option in Admin → Settings, in the same order (the
  // Sprocket Rating bonus has its own table below). Anything set to 0
  // doesn't affect scores, so it's left out.
  const statRows: [string, number][] = rules
    ? ([
        ["Goal", rules.goals],
        ["Goal Against", rules.goalsAgainst],
        ["Shot", rules.shots],
        ["Shot Against", rules.shotsAgainst],
        ["Save", rules.saves],
        ["Assist", rules.assists],
        ["Demo Inflicted", rules.demosInflicted],
        ["Demo Taken", rules.demosTaken],
        ["Game Won", rules.gameWin],
        ["Game Lost", rules.gameLoss],
      ] as [string, number][]).filter(([, value]) => value !== 0)
    : [];
  const bonusRanges = rules ? rules.sprocketRatingRanges.filter((r) => r.points !== 0) : [];

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
            <p
              style={{
                fontSize: "0.8rem",
                color: "var(--text-muted)",
                marginBottom: "0.6rem",
              }}
            >
              Points for each one an MLE team gets in a week, in the mode
              it&apos;s scored for. Games are counted individually: a series
              won 3-2 is 3 games won and 2 lost. A forfeit usually counts as
              5-0, so the winner gets 5 games won and the forfeiting team 5
              games lost.
            </p>
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

            {bonusRanges.length > 0 && (
              <>
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
                  A flat bonus is added based on which range a team&apos;s
                  Sprocket Rating falls into that week (not multiplied).
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
                    {bonusRanges.map((r, i) => (
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
                            color: r.points < 0 ? "#ef4444" : "var(--accent)",
                          }}
                        >
                          {r.points > 0 ? "+" : ""}
                          {r.points}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
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
          Each league uses one of these three, chosen when it&apos;s created. The Waivers tab on your roster
          page shows yours: a waiver priority order, or your FAAB budget.
        </p>

        <div style={{ marginBottom: "1.25rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--accent)", marginBottom: "0.4rem" }}>
            Fixed Order (Priority)
          </h3>
          <p style={{ fontSize: "0.88rem", color: "var(--text-main)", lineHeight: 1.6 }}>
            Managers start in a priority order based on reverse draft order (the last pick gets priority
            #1). When two managers claim the same team, the one higher in the order gets it. Winning a
            claim sends you to the back of the line; if you don&apos;t win anything, you keep your spot.
            At the start of each new week, the order resets to reverse standings, so the last-place team
            gets priority #1.
          </p>
        </div>

        <div style={{ marginBottom: "1.25rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--accent)", marginBottom: "0.4rem" }}>
            Rolling Waivers
          </h3>
          <p style={{ fontSize: "0.88rem", color: "var(--text-main)", lineHeight: 1.6 }}>
            Works like Fixed Order: it starts at reverse draft order, and winning a claim sends you to the
            back of the line. The difference is that the order never resets. It keeps rolling from week to
            week for the whole season, whatever the standings.
          </p>
        </div>

        <div>
          <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--accent)", marginBottom: "0.4rem" }}>
            FAAB (Free Agent Acquisition Budget)
          </h3>
          <p style={{ fontSize: "0.88rem", color: "var(--text-main)", lineHeight: 1.6 }}>
            Every team gets a budget for the whole season, set by your league admin. To claim a team on
            waivers, you place a secret bid. The highest bid wins, and that amount comes out of the
            winner&apos;s budget. Equal bids go to whoever is higher in waiver priority (reverse draft order
            to start, then reverse standings from each new week on). If the top bidder can&apos;t complete the claim, for example because their budget no longer
            covers it, the next-highest bidder gets the team. FAAB can also be traded.
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
            Each fantasy team has 8 spots: two <strong>2s</strong>, two{" "}
            <strong>3s</strong>, one <strong>FLX</strong> and three{" "}
            <strong>Bench</strong>. A 2s or 3s spot scores only that mode&apos;s
            stats for the MLE team in it. FLX scores whichever mode that team
            scored more in that week. Bench teams don&apos;t count toward your
            score.
          </p>
        </Section>

        <Section title="The Draft">
          <p>
            Drafts happen in the Draft Room: open it with the gold{" "}
            <strong>Draft</strong> button at the top of your league. While you
            wait, you can browse every available team&apos;s stats from last
            season, filtered by MLE league and mode, and line teams up in your{" "}
            <strong>Queue</strong>.
          </p>
          <p>
            Each pick has a timer. If yours runs out, the site picks for you:
            the first team in your queue that&apos;s still available, or a random
            team if there isn&apos;t one. It also turns on{" "}
            <strong>Autodraft</strong>, so your later picks are made the same way
            as soon as it&apos;s your turn. You can turn it back off in the Draft
            Room.
          </p>
          <p>
            Some leagues draft outside the site instead. An admin then enters
            everyone&apos;s rosters. Trades, waivers, pickups and drops open once
            your league&apos;s draft is complete.
          </p>
        </Section>

        <Section title="Each Week">
          <p>
            You play one other manager each week, and your starting lineup (2s,
            3s and FLX) is scored against theirs.
          </p>
          <p>
            Lineups lock at 12:00am ET on the first day of that week&apos;s
            matches (usually Thursday) and unlock at 11:59pm ET on the last day
            (usually Sunday), so set your lineup before matches begin. During
            that match weekend, you also can&apos;t pick up or drop teams or
            propose trades, but you can still put in waiver claims.
          </p>
          <p>
            Stats refresh automatically every 2 hours, so scores update as games
            are played.
          </p>
        </Section>

        <Section title="Scoring">
          <p>
            Each starting MLE team earns points from its real match stats in its
            mode that week, such as goals, saves, assists, shots and demos. It
            also gets a bonus based on its Sprocket Rating, and points for each
            game it wins or loses. The exact values are set each season.
          </p>
          <p>
            Some leagues also use <strong>Double Win</strong>: on top of your
            matchup result, the top half of the league by score each
            regular-season week gets an extra win, and the bottom half an extra
            loss.
          </p>
          <DetailButton onClick={() => setShowScoringDetail(true)}>
            View exact point values →
          </DetailButton>
        </Section>

        <Section title="Trades">
          <p>
            Propose a trade from the <strong>Opponents</strong> page. If it
            would overfill a roster, that manager picks which teams to drop. In
            FAAB leagues, either side can also send FAAB in whole dollars, but
            every trade has to include at least one team.
          </p>
          <p>
            Once accepted, a trade waits 12 hours so a league admin can veto it,
            then goes through automatically. If lineups lock before then, it
            goes through as the lock starts. It&apos;s cancelled instead if a
            team in it has left its roster, a roster no longer has room, or a
            side no longer has the FAAB it offered.
          </p>
          <p>
            The trade deadline is 11:59pm ET the night before your league&apos;s
            first playoff matches.
          </p>
        </Section>

        <Section title="Waivers & Free Agents">
          <p>
            A team nobody has is a <strong>free agent</strong>. Pick it up right
            away from the <strong>MLE Teams</strong> page.
          </p>
          <p>
            A team a manager just dropped is on <strong>waivers</strong> until
            the next waiver run, so you put in a claim for it instead. The
            Waivers tab on your roster page shows when the next run is and your
            pending claims, which only you can see. If nobody claims a team, it
            becomes a free agent after the run.
          </p>
          <DetailButton onClick={() => setShowWaiverSystems(true)}>
            How do the waiver systems work? →
          </DetailButton>
        </Section>

        <Section title="Standings & Playoffs">
          <p>
            Standings rank teams by win percentage, then total points scored,
            then fewest points against.
          </p>
          <ul style={{ margin: 0, paddingLeft: "1.25rem", listStyleType: "disc" }}>
            <li>
              <strong>8 and 10-team leagues:</strong> 8 regular-season weeks,
              then the top 4 play a 2-week playoff.
            </li>
            <li>
              <strong>12-team leagues:</strong> 7 regular-season weeks, then the
              top 6 play a 3-week playoff, with the top 2 seeds skipping the
              first round.
            </li>
          </ul>
          <p>
            Everyone else plays a consolation bracket for the remaining places.
            Playoff matchups are set automatically as each week&apos;s scores
            come in. A league that drafts late plays fewer regular-season weeks,
            and its playoffs still start on time.
          </p>
        </Section>

        <Section title="Discord DMs">
          <p>
            Turn on Discord DMs under <strong>Notifications</strong> on the home
            page to get alerts for your draft turns, trades, waiver results,
            lineup reminders and weekly results. You choose which ones you get.
            To receive them, you need to be in the MLE Discord server and allow
            DMs from its members.
          </p>
        </Section>

        <Section title="Where to find things">
          <ul style={{ margin: 0, paddingLeft: "1.25rem", listStyleType: "disc" }}>
            <li>
              <strong>Draft</strong>: the Draft Room, until your season starts.
            </li>
            <li>
              <strong>My Roster</strong>: your lineup, plus your Trades and
              Waivers tabs.
            </li>
            <li>
              <strong>MLE Teams</strong>: every MLE team&apos;s stats, and where
              you pick up free agents or claim teams on waivers.
            </li>
            <li>
              <strong>Scoreboard</strong>: this week&apos;s matchups and scores.
            </li>
            <li>
              <strong>Standings</strong>: the standings and playoff brackets.
            </li>
            <li>
              <strong>Opponents</strong>: the other managers&apos; rosters, and
              where you propose trades.
            </li>
          </ul>
        </Section>
      </div>
    </div>
  );
}
