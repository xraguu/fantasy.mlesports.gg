# CSV Data Import

This directory contains CSV files for importing MLE data into the fantasy platform.

## Required Files

Place the following CSV files in this directory:

1. **teams.csv** - MLE teams and leagues data

   - Columns: Conference, Super Division, Division, Franchise, Code, Primary Color, Secondary Color, Photo URL

2. **players.csv** - MLE players data

   - Columns: name, salary, sprocket_player_id, member_id, skill_group, franchise, Franchise Staff Position, slot, current_scrim_points, Eligible Until

3. **fixtures.csv** - Match fixtures

   - Columns: fixture_id, match_group_id, home, away

4. **matches.csv** - Individual matches

   - Columns: match_id, fixture_id, match_group_id, scheduling_start_time, scheduling_end_time, home, away, league, game_mode, home_wins, away_wins, winning_team

5. **rounds_s19.csv** - Season 19 rounds data

   - Columns: match_id, round_id, Home, Home Goals, Away, Away Goals

6. **match_groups.csv** - Match group information

   - Columns: match_group_id, start, end, match_group_title, parent_group_title

7. **role_usages.csv** - Player position usage

   - Columns: doubles_uses, standard_uses, total_uses, season_number, team_name, league, role

8. **player_stats_s19.csv** - Player match statistics

   - Columns: member_id, team_name, skill_group, gamemode, match_id, round_id, replays_submitted_at, home_won, dpi, gpi, opi, goals, saves, score, shots, assists, goals_against, shots_against, demos_inflicted, demos_taken

9. **historicalAggregatedPlayerStats.csv** - Historical player statistics
   - Columns: name, member_id, gamemode, skill_group, team_name, season, games_played, sprocket_rating, dpi_per_game, opi_per_game, avg_score, goals_per_game, total_goals, saves_per_game, total_saves, shots_per_game, total_shots, assists_per_game, total_assists, avg_goals_against, total_goals_against, avg_shots_against, total_shots_against, avg_demos_inflicted, total_demos_inflicted, avg_demos_taken, total_demos_taken

## Running the Import

After placing all CSV files in this directory, run:

```bash
npm run import:csv
```

## Import Order

The script imports data in the following order to maintain referential integrity:

1. Leagues and Teams
2. Players
3. Fixtures
4. Matches
5. Role Usages
6. Player Match Stats
7. Historical Player Stats

## Notes

- The script uses upsert operations, so it's safe to run multiple times
- Missing CSV files will be skipped with a warning
- Invalid data rows will be logged but won't stop the import
- Fantasy weeks are calculated automatically based on match dates
