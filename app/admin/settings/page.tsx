"use client";

import { useState, useEffect } from "react";
import { useAlert } from "@/components/AlertProvider";

// Week date structure — a week's calendar boundary (weekStart), when its
// real matches actually begin (matchStart, which can fall several days
// later — this is when lineups lock and the trade blackout starts), and
// when both the matches and the week are over (weekEnd).
interface WeekDate {
  week: number;
  weekStart: string;
  matchStart: string;
  weekEnd: string;
}

// Settings structure matching requirements
const defaultSettings = {
  weekDates: Array.from({ length: 10 }, (_, i) => ({
    week: i + 1,
    weekStart: "",
    matchStart: "",
    weekEnd: "",
  })) as WeekDate[],
  draftStatsSeason: null as string | null,
  scoring: {
    goals: 2,
    goalsAgainst: -2,
    shots: 0.1,
    shotsAgainst: -0.1,
    saves: 1,
    assists: 1.5,
    demosInflicted: 0.5,
    demosTaken: -0.5, // Negative example
    sprocketRatingRanges: [
      { min: 0, max: 30, points: 0 },
      { min: 31, max: 50, points: 5 },
      { min: 51, max: 70, points: 10 },
      { min: 71, max: 90, points: 15 },
      { min: 91, max: 100, points: 20 },
    ],
    gameWin: 10,
    gameLoss: 0, // Can be negative
  },
  waivers: {
    processingSchedule: [
      { day: "Wednesday", time: "03:00" },
      { day: "Sunday", time: "03:00" }
    ],
  },
};

export default function SettingsPage() {
  const showAlert = useAlert();
  const [settings, setSettings] = useState(defaultSettings);
  const [hasChanges, setHasChanges] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [availableHistoricalSeasons, setAvailableHistoricalSeasons] = useState<string[]>([]);
  const [availableLeagueSeasons, setAvailableLeagueSeasons] = useState<number[]>([]);
  const [currentSeason, setCurrentSeason] = useState<number | null>(null);

  // Load settings from API on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch("/api/admin/settings");
        if (response.ok) {
          const data = await response.json();
          setAvailableHistoricalSeasons(data.availableHistoricalSeasons || []);
          setAvailableLeagueSeasons(data.availableLeagueSeasons || []);
          setCurrentSeason(data.currentSeason ?? null);
          if (data.settings) {
            // Transform API data to match UI structure
            setSettings({
              weekDates: data.settings.weekDates || defaultSettings.weekDates,
              scoring: data.settings.scoringRules || defaultSettings.scoring,
              waivers: {
                processingSchedule: data.settings.waiverSchedule || defaultSettings.waivers.processingSchedule,
              },
              draftStatsSeason: data.settings.draftStatsSeason ?? null,
            });
          }
        }
      } catch (error) {
        console.error("Error loading settings:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, []);

  const updateScoringSetting = (key: string, value: number) => {
    setSettings((prev) => ({
      ...prev,
      scoring: {
        ...prev.scoring,
        [key]: value,
      },
    }));
    setHasChanges(true);
  };

  const addSprocketRange = () => {
    const ranges = settings.scoring.sprocketRatingRanges || [];
    const lastRange = ranges[ranges.length - 1];
    const newRange = {
      min: lastRange ? lastRange.max + 1 : 0,
      max: lastRange ? lastRange.max + 20 : 20,
      points: 0,
    };
    setSettings((prev) => ({
      ...prev,
      scoring: {
        ...prev.scoring,
        sprocketRatingRanges: [...ranges, newRange],
      },
    }));
    setHasChanges(true);
  };

  const updateSprocketRange = (index: number, field: 'min' | 'max' | 'points', value: number) => {
    const newRanges = [...(settings.scoring.sprocketRatingRanges || [])];
    newRanges[index] = { ...newRanges[index], [field]: value };
    setSettings((prev) => ({
      ...prev,
      scoring: {
        ...prev.scoring,
        sprocketRatingRanges: newRanges,
      },
    }));
    setHasChanges(true);
  };

  const removeSprocketRange = (index: number) => {
    const newRanges = (settings.scoring.sprocketRatingRanges || []).filter((_, i) => i !== index);
    setSettings((prev) => ({
      ...prev,
      scoring: {
        ...prev.scoring,
        sprocketRatingRanges: newRanges,
      },
    }));
    setHasChanges(true);
  };

  const updateWeekDate = (week: number, field: 'weekStart' | 'matchStart' | 'weekEnd', value: string) => {
    setSettings((prev) => ({
      ...prev,
      weekDates: prev.weekDates.map(w =>
        w.week === week ? { ...w, [field]: value } : w
      ),
    }));
    setHasChanges(true);
  };

  const saveSettings = async () => {
    setIsSaving(true);
    try {
      // Transform UI structure to API format — season/playoffStartWeek/
      // lineupLockTime are no longer sent; the API derives/fixes those itself.
      const apiData = {
        weekDates: settings.weekDates,
        scoringRules: settings.scoring,
        waiverSchedule: settings.waivers.processingSchedule,
        draftStatsSeason: settings.draftStatsSeason,
        currentSeason,
      };

      const response = await fetch("/api/admin/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(apiData),
      });

      if (response.ok) {
        showAlert("Settings saved successfully!", "success");
        setHasChanges(false);
      } else {
        const error = await response.json();
        showAlert(`Failed to save settings: ${error.error || "Unknown error"}`, "error");
      }
    } catch (error) {
      console.error("Error saving settings:", error);
      showAlert("Failed to save settings. Please try again.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const resetSettings = () => {
    if (confirm("Are you sure you want to reset all settings to defaults?")) {
      setSettings(defaultSettings);
      setHasChanges(true); // Mark as changed so user can save the reset
    }
  };

  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: "3rem" }}>
        <p style={{ color: "var(--text-muted)", fontSize: "1.1rem" }}>Loading settings...</p>
      </div>
    );
  }

  return (
    <div>
      {/* Save/Reset Buttons - Sticky Top */}
      {hasChanges && (
        <div
          style={{
            position: "sticky",
            top: "2rem",
            zIndex: 10,
            padding: "1rem",
            background: "var(--bg-surface)",
            borderRadius: "8px",
            marginBottom: "1.5rem",
            border: "2px solid var(--accent)",
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "0.75rem",
          }}
        >
          <span
            style={{
              fontSize: "0.95rem",
              color: "var(--accent)",
              fontWeight: 600,
            }}
          >
            You have unsaved changes
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            <button
              className="btn btn-ghost"
              onClick={resetSettings}
              disabled={isSaving}
            >
              Reset to Defaults
            </button>
            <button
              className="btn btn-primary"
              onClick={saveSettings}
              disabled={isSaving}
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      )}

      {/* Season Settings */}
      <div className="card" style={{ padding: "2rem", marginBottom: "2rem" }}>
        <h2
          style={{
            fontSize: "clamp(1.1rem, 4.5vw, 1.5rem)",
            fontWeight: 700,
            marginBottom: "1.5rem",
            color: "var(--accent)",
          }}
        >
          Season Settings
        </h2>
        
        {/* Draft Room "Last Season" Stats */}
        <div style={{ marginBottom: "1.5rem" }}>
          <label
            style={{
              display: "block",
              marginBottom: "0.5rem",
              fontSize: "0.9rem",
              color: "var(--text-muted)",
              fontWeight: 600,
            }}
          >
            Draft Room &quot;Last Season&quot; Stats
          </label>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
            Which completed regular season&apos;s stats show as &quot;last season&quot; in the draft room&apos;s Available Teams tab.
          </p>
          <select
            value={settings.draftStatsSeason ?? ""}
            onChange={(e) => {
              setSettings((prev) => ({ ...prev, draftStatsSeason: e.target.value || null }));
              setHasChanges(true);
            }}
            style={{
              width: "100%",
              maxWidth: "300px",
              padding: "0.75rem",
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: "6px",
              color: "var(--text-main)",
              fontSize: "0.95rem",
            }}
          >
            <option value="">
              {availableHistoricalSeasons.length > 0 ? "Most recent available" : "No historical seasons imported yet"}
            </option>
            {availableHistoricalSeasons.map((season) => (
              <option key={season} value={season}>
                {season}
              </option>
            ))}
          </select>
        </div>

        {/* Current Season */}
        <div style={{ marginBottom: "1.5rem" }}>
          <label
            style={{
              display: "block",
              marginBottom: "0.5rem",
              fontSize: "0.9rem",
              color: "var(--text-muted)",
              fontWeight: 600,
            }}
          >
            Current Season
          </label>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
            Which season counts as active league-wide — decides things like which leagues show up under &quot;Your Leagues&quot; vs. the archive.
          </p>
          <select
            value={currentSeason?.toString() ?? ""}
            onChange={(e) => {
              setCurrentSeason(e.target.value ? parseInt(e.target.value, 10) : null);
              setHasChanges(true);
            }}
            style={{
              width: "100%",
              maxWidth: "300px",
              padding: "0.75rem",
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: "6px",
              color: "var(--text-main)",
              fontSize: "0.95rem",
            }}
          >
            <option value="">
              {availableLeagueSeasons.length > 0 ? "Most recent league" : "No leagues created yet"}
            </option>
            {availableLeagueSeasons.map((season) => (
              <option key={season} value={season}>
                {season}
              </option>
            ))}
          </select>
        </div>

        {/* Weekly Schedule */}
        <div style={{ marginTop: "2rem" }}>
          <h3 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "1rem", color: "var(--text-main)" }}>
            Weekly Schedule (10 Weeks)
          </h3>
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {settings.weekDates.map((weekData) => (
              <div
                key={weekData.week}
                className="admin-week-schedule-grid"
                style={{
                  padding: "1rem",
                  background: "rgba(255,255,255,0.03)",
                  borderRadius: "6px",
                  border: "1px solid rgba(255,255,255,0.1)",
                  alignItems: "center",
                }}
              >
                <div style={{ fontWeight: 600, color: "var(--accent)" }}>
                  Week {weekData.week}
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    Week Start
                  </label>
                  <input
                    type="date"
                    value={weekData.weekStart}
                    onChange={(e) => updateWeekDate(weekData.week, 'weekStart', e.target.value)}
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      background: "rgba(255,255,255,0.1)",
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: "4px",
                      color: "var(--text-main)",
                      fontSize: "0.85rem",
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    Match Start
                  </label>
                  <input
                    type="date"
                    value={weekData.matchStart}
                    onChange={(e) => updateWeekDate(weekData.week, 'matchStart', e.target.value)}
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      background: "rgba(255,255,255,0.1)",
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: "4px",
                      color: "var(--text-main)",
                      fontSize: "0.85rem",
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    Week End
                  </label>
                  <input
                    type="date"
                    value={weekData.weekEnd}
                    onChange={(e) => updateWeekDate(weekData.week, 'weekEnd', e.target.value)}
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      background: "rgba(255,255,255,0.1)",
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: "4px",
                      color: "var(--text-main)",
                      fontSize: "0.85rem",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.75rem" }}>
            <strong style={{ color: "var(--text-main)" }}>Week Start</strong> is when the new fantasy week begins (rosters carry forward, waivers reset/release) — <strong style={{ color: "var(--text-main)" }}>Match Start</strong> is when that week&apos;s real matches begin and lineups lock/trades stop — <strong style={{ color: "var(--text-main)" }}>Week End</strong> is when matches and the week are both over and lineups unlock.
          </p>
        </div>
      </div>

      {/* Scoring Rules */}
      <div className="card" style={{ padding: "2rem", marginBottom: "2rem" }}>
        <h2
          style={{
            fontSize: "clamp(1.1rem, 4.5vw, 1.5rem)",
            fontWeight: 700,
            marginBottom: "0.5rem",
            color: "var(--accent)",
          }}
        >
          Scoring Rules
        </h2>
        <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginBottom: "1.5rem" }}>
          Points per stat (negative values allowed)
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "1.5rem",
          }}
        >
          <div>
            <label
              style={{
                display: "block",
                marginBottom: "0.5rem",
                fontSize: "0.9rem",
                color: "var(--text-muted)",
                fontWeight: 600,
              }}
            >
              Goals
            </label>
            <input
              type="number"
              value={settings.scoring.goals}
              onChange={(e) =>
                updateScoringSetting("goals", Number(e.target.value))
              }
              step={0.1}
              style={{
                width: "100%",
                padding: "0.75rem",
                background: "rgba(255,255,255,0.1)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "6px",
                color: "var(--text-main)",
                fontSize: "0.95rem",
              }}
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                marginBottom: "0.5rem",
                fontSize: "0.9rem",
                color: "var(--text-muted)",
                fontWeight: 600,
              }}
            >
              Goals Against
            </label>
            <input
              type="number"
              value={settings.scoring.goalsAgainst}
              onChange={(e) =>
                updateScoringSetting("goalsAgainst", Number(e.target.value))
              }
              step={0.1}
              style={{
                width: "100%",
                padding: "0.75rem",
                background: "rgba(255,255,255,0.1)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "6px",
                color: "var(--text-main)",
                fontSize: "0.95rem",
              }}
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                marginBottom: "0.5rem",
                fontSize: "0.9rem",
                color: "var(--text-muted)",
                fontWeight: 600,
              }}
            >
              Shots
            </label>
            <input
              type="number"
              value={settings.scoring.shots}
              onChange={(e) =>
                updateScoringSetting("shots", Number(e.target.value))
              }
              step={0.1}
              style={{
                width: "100%",
                padding: "0.75rem",
                background: "rgba(255,255,255,0.1)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "6px",
                color: "var(--text-main)",
                fontSize: "0.95rem",
              }}
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                marginBottom: "0.5rem",
                fontSize: "0.9rem",
                color: "var(--text-muted)",
                fontWeight: 600,
              }}
            >
              Shots Against
            </label>
            <input
              type="number"
              value={settings.scoring.shotsAgainst}
              onChange={(e) =>
                updateScoringSetting("shotsAgainst", Number(e.target.value))
              }
              step={0.1}
              style={{
                width: "100%",
                padding: "0.75rem",
                background: "rgba(255,255,255,0.1)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "6px",
                color: "var(--text-main)",
                fontSize: "0.95rem",
              }}
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                marginBottom: "0.5rem",
                fontSize: "0.9rem",
                color: "var(--text-muted)",
                fontWeight: 600,
              }}
            >
              Saves
            </label>
            <input
              type="number"
              value={settings.scoring.saves}
              onChange={(e) =>
                updateScoringSetting("saves", Number(e.target.value))
              }
              step={0.1}
              style={{
                width: "100%",
                padding: "0.75rem",
                background: "rgba(255,255,255,0.1)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "6px",
                color: "var(--text-main)",
                fontSize: "0.95rem",
              }}
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                marginBottom: "0.5rem",
                fontSize: "0.9rem",
                color: "var(--text-muted)",
                fontWeight: 600,
              }}
            >
              Assists
            </label>
            <input
              type="number"
              value={settings.scoring.assists}
              onChange={(e) =>
                updateScoringSetting("assists", Number(e.target.value))
              }
              step={0.1}
              style={{
                width: "100%",
                padding: "0.75rem",
                background: "rgba(255,255,255,0.1)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "6px",
                color: "var(--text-main)",
                fontSize: "0.95rem",
              }}
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                marginBottom: "0.5rem",
                fontSize: "0.9rem",
                color: "var(--text-muted)",
                fontWeight: 600,
              }}
            >
              Demos Inflicted
            </label>
            <input
              type="number"
              value={settings.scoring.demosInflicted}
              onChange={(e) =>
                updateScoringSetting("demosInflicted", Number(e.target.value))
              }
              step={0.1}
              style={{
                width: "100%",
                padding: "0.75rem",
                background: "rgba(255,255,255,0.1)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "6px",
                color: "var(--text-main)",
                fontSize: "0.95rem",
              }}
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                marginBottom: "0.5rem",
                fontSize: "0.9rem",
                color: "var(--text-muted)",
                fontWeight: 600,
              }}
            >
              Demos Taken
            </label>
            <input
              type="number"
              value={settings.scoring.demosTaken}
              onChange={(e) =>
                updateScoringSetting("demosTaken", Number(e.target.value))
              }
              step={0.1}
              style={{
                width: "100%",
                padding: "0.75rem",
                background: "rgba(255,255,255,0.1)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "6px",
                color: "var(--text-main)",
                fontSize: "0.95rem",
              }}
            />
            <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
              Typically negative (penalty)
            </p>
          </div>


          <div>
            <label
              style={{
                display: "block",
                marginBottom: "0.5rem",
                fontSize: "0.9rem",
                color: "var(--text-muted)",
                fontWeight: 600,
              }}
            >
              Game Win
            </label>
            <input
              type="number"
              value={settings.scoring.gameWin}
              onChange={(e) =>
                updateScoringSetting("gameWin", Number(e.target.value))
              }
              step={0.5}
              style={{
                width: "100%",
                padding: "0.75rem",
                background: "rgba(255,255,255,0.1)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "6px",
                color: "var(--text-main)",
                fontSize: "0.95rem",
              }}
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                marginBottom: "0.5rem",
                fontSize: "0.9rem",
                color: "var(--text-muted)",
                fontWeight: 600,
              }}
            >
              Game Loss
            </label>
            <input
              type="number"
              value={settings.scoring.gameLoss}
              onChange={(e) =>
                updateScoringSetting("gameLoss", Number(e.target.value))
              }
              step={0.5}
              style={{
                width: "100%",
                padding: "0.75rem",
                background: "rgba(255,255,255,0.1)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "6px",
                color: "var(--text-main)",
                fontSize: "0.95rem",
              }}
            />
            <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
              Can be negative (penalty)
            </p>
          </div>
        </div>

        {/* Sprocket Rating Ranges Section */}
        <div style={{ marginTop: "2.5rem", paddingTop: "2rem", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
            <div>
              <h3 style={{ fontSize: "1.2rem", fontWeight: 600, color: "var(--text-main)", marginBottom: "0.25rem" }}>
                Sprocket Rating (SR) Point Ranges
              </h3>
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                Points are added based on the team&apos;s Sprocket Rating range
              </p>
            </div>
            <button
              className="btn btn-primary"
              style={{ padding: "0.5rem 1rem", fontSize: "0.85rem" }}
              onClick={addSprocketRange}
            >
              + Add Range
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {(settings.scoring.sprocketRatingRanges || []).map((range, index) => (
              <div
                key={index}
                className="admin-sprocket-range-grid"
                style={{
                  padding: "1rem",
                  background: "rgba(255,255,255,0.03)",
                  borderRadius: "6px",
                  border: "1px solid rgba(255,255,255,0.1)",
                  alignItems: "end",
                }}
              >
                <div>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>
                    Min Rating
                  </label>
                  <input
                    type="number"
                    value={range.min}
                    onChange={(e) => updateSprocketRange(index, 'min', Number(e.target.value))}
                    min={0}
                    style={{
                      width: "100%",
                      padding: "0.65rem",
                      background: "rgba(255,255,255,0.1)",
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: "4px",
                      color: "var(--text-main)",
                      fontSize: "0.9rem",
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>
                    Max Rating
                  </label>
                  <input
                    type="number"
                    value={range.max}
                    onChange={(e) => updateSprocketRange(index, 'max', Number(e.target.value))}
                    min={0}
                    style={{
                      width: "100%",
                      padding: "0.65rem",
                      background: "rgba(255,255,255,0.1)",
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: "4px",
                      color: "var(--text-main)",
                      fontSize: "0.9rem",
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 600 }}>
                    Points Added
                  </label>
                  <input
                    type="number"
                    value={range.points}
                    onChange={(e) => updateSprocketRange(index, 'points', Number(e.target.value))}
                    step={0.5}
                    style={{
                      width: "100%",
                      padding: "0.65rem",
                      background: "rgba(255,255,255,0.1)",
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: "4px",
                      color: "var(--text-main)",
                      fontSize: "0.9rem",
                    }}
                  />
                </div>

                <button
                  className="btn btn-ghost"
                  style={{ padding: "0.65rem 1rem", fontSize: "0.85rem" }}
                  onClick={() => removeSprocketRange(index)}
                  disabled={(settings.scoring.sprocketRatingRanges || []).length === 1}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div style={{ marginTop: "1rem", padding: "1rem", background: "rgba(242, 182, 50, 0.1)", borderRadius: "6px", borderLeft: "3px solid var(--accent)" }}>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
              <strong style={{ color: "var(--text-main)" }}>Example:</strong> If a team has SR of 65, and the range 51-70 has +10 points, that team will receive an additional 10 points to their total fantasy points.
            </p>
          </div>
        </div>
      </div>

      {/* Waiver Processing Schedule */}
      <div className="card" style={{ padding: "2rem" }}>
        <h2
          style={{
            fontSize: "clamp(1.1rem, 4.5vw, 1.5rem)",
            fontWeight: 700,
            marginBottom: "0.5rem",
            color: "var(--accent)",
          }}
        >
          Waiver Processing Schedule
        </h2>
        <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginBottom: "1.5rem" }}>
          Times for waivers to be processed automatically
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
          <h3 style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--text-main)" }}>
            Processing Times
          </h3>
          <button
            className="btn btn-primary"
            style={{ padding: "0.5rem 1rem", fontSize: "0.85rem" }}
            onClick={() => {
              const newSchedule = [...settings.waivers.processingSchedule, { day: "Monday", time: "03:00" }];
              setSettings(prev => ({ ...prev, waivers: { ...prev.waivers, processingSchedule: newSchedule } }));
              setHasChanges(true);
            }}
          >
            + Add Time
          </button>
        </div>

        {settings.waivers.processingSchedule.map((schedule, index) => (
          <div
            key={index}
            className="admin-waiver-schedule-grid"
            style={{
              marginBottom: "1rem",
              alignItems: "end"
            }}
          >
            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.9rem", color: "var(--text-muted)", fontWeight: 600 }}>
                Day
              </label>
              <select
                value={schedule.day}
                onChange={(e) => {
                  const newSchedule = [...settings.waivers.processingSchedule];
                  newSchedule[index].day = e.target.value;
                  setSettings(prev => ({ ...prev, waivers: { ...prev.waivers, processingSchedule: newSchedule } }));
                  setHasChanges(true);
                }}
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  background: "rgba(255,255,255,0.1)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: "6px",
                  color: "var(--text-main)",
                  fontSize: "0.95rem",
                }}
              >
                <option>Monday</option>
                <option>Tuesday</option>
                <option>Wednesday</option>
                <option>Thursday</option>
                <option>Friday</option>
                <option>Saturday</option>
                <option>Sunday</option>
              </select>
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.9rem", color: "var(--text-muted)", fontWeight: 600 }}>
                Time
              </label>
              <input
                type="time"
                value={schedule.time}
                onChange={(e) => {
                  const newSchedule = [...settings.waivers.processingSchedule];
                  newSchedule[index].time = e.target.value;
                  setSettings(prev => ({ ...prev, waivers: { ...prev.waivers, processingSchedule: newSchedule } }));
                  setHasChanges(true);
                }}
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  background: "rgba(255,255,255,0.1)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: "6px",
                  color: "var(--text-main)",
                  fontSize: "0.95rem",
                }}
              />
            </div>

            <button
              className="btn btn-ghost"
              style={{ padding: "0.75rem 1rem", fontSize: "0.85rem" }}
              onClick={() => {
                const newSchedule = settings.waivers.processingSchedule.filter((_, i) => i !== index);
                setSettings(prev => ({ ...prev, waivers: { ...prev.waivers, processingSchedule: newSchedule } }));
                setHasChanges(true);
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      {/* Bottom Save Button - Sticky */}
      {hasChanges && (
        <div
          style={{
            position: "sticky",
            bottom: "2rem",
            marginTop: "2rem",
            padding: "1rem",
            background: "var(--bg-surface)",
            borderRadius: "8px",
            border: "2px solid var(--accent)",
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "0.75rem",
          }}
        >
          <span
            style={{
              fontSize: "0.95rem",
              color: "var(--accent)",
              fontWeight: 600,
            }}
          >
            Remember to save your changes!
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            <button
              className="btn btn-ghost"
              onClick={resetSettings}
              disabled={isSaving}
            >
              Reset to Defaults
            </button>
            <button
              className="btn btn-primary"
              onClick={saveSettings}
              disabled={isSaving}
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
