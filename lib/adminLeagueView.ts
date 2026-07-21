// Whether the admin panel's "View League" button was actually clicked for a
// given league, in this browser tab — an explicit, intentional signal,
// stored in sessionStorage so it survives client-side navigation across
// Scoreboard/Standings/Managers without needing every internal link and
// router.push call in those pages to thread a query param through.
//
// Deliberately NOT inferred from "does this admin own a team in the
// league" — an admin can genuinely also be a manager in one of their own
// leagues (this app's own test leagues are a real example), and clicking
// "View League" is a clear request for the read-only admin view regardless
// of that, not a request to fall back to their normal manager experience.
const STORAGE_KEY = "adminViewLeagueId";

export function setAdminViewingLeague(leagueId: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, leagueId);
}

export function clearAdminViewingLeague(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(STORAGE_KEY);
}

export function isAdminViewingLeague(leagueId: string): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(STORAGE_KEY) === leagueId;
}
