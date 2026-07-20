export interface FantasyLeague {
  id: string; // e.g. "2025-alpha" or a UUID
  name: string; // "2025 RL Fantasy Alpha"
  season: number; // 2025
  maxTeams: number; // usually 12
  createdAt: Date;
  createdByUserId: string;
}
