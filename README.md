# Winnipeg Jets Players Dataset

This project maintains a source-controlled JSON dataset of **every player who has appeared in at least one game for the Winnipeg Jets (`WPG`)**, including both:

- skaters
- goalies

The dataset is generated from the NHL web API host:

- `https://api-web.nhle.com/v1/`

## Dataset output

Generated file:

- `data/wpg_players.json`

Each player object includes:

- `playerId`
- `playerName`
- `position`
- `seasons` (per-season game totals)
  - `season`
  - `gamesPlayedRegularSeason`
  - `gamesPlayedPlayoffs`
- `gamesPlayedRegularSeason` (career total with WPG)
- `gamesPlayedPlayoffs` (career total with WPG)

A player is included if they have at least one game played in either regular season or playoffs with the Jets.

## How generation works

The generator script:

- gets all available Winnipeg seasons from `club-stats-season/WPG`
- fetches season stats for game types:
  - `2` (regular season)
  - `3` (playoffs)
- merges skaters and goalies by player ID
- computes per-season and total GP values

Script location:

- `scripts/generate_wpg_players.py`

Run locally:

```bash
python scripts/generate_wpg_players.py
```

## GitHub Actions workflow

Workflow file:

- `.github/workflows/generate-wpg-players.yml`

The workflow:

- can be run manually via **workflow_dispatch**
- regenerates `data/wpg_players.json`
- commits and pushes updates automatically when the dataset changes

This setup is intended to keep an always-up-to-date canonical list of all Winnipeg Jets players in source control.
