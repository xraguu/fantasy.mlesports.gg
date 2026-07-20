// Team name/short code are never admin-entered — always derived from the
// user's own display name, so there's one less thing to type per manager
// added and no chance of a name that doesn't match who actually owns the team.

export function baseShortCode(displayName: string): string {
  const letters = displayName.replace(/[^a-zA-Z]/g, "").toUpperCase();
  return letters.slice(0, 3).padEnd(3, "X");
}

export function uniqueShortCode(displayName: string, taken: Set<string>): string {
  const base = baseShortCode(displayName);
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i <= 9; i++) {
    const candidate = base.slice(0, 2) + i;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  for (let i = 0; i < 26; i++) {
    const candidate = base.slice(0, 1) + String.fromCharCode(65 + i) + "X";
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return base; // exhausted — falls through to the existing duplicate-shortcode error as a safety net
}

export function uniqueTeamName(displayName: string, taken: Set<string>): string {
  const base = `${displayName}'s Team`;
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} (${n})`.toLowerCase())) n++;
  return `${base} (${n})`;
}
