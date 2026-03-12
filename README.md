# Winnipeg Jets Players Dataset

This project maintains a source-controlled JSON dataset of **every player who has appeared in at least one game for Winnipeg Jets franchise records (`WPG` + `WIN`)**, including both:

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

## Web page

A static HTML page is included at the repository root:

- `index.html`

It loads player data dynamically from:

- `data/wpg_players.json`

The table is rendered in JavaScript (`app.js`) so the website does not duplicate the dataset in markup.

## How generation works

The generator script:

- gets all available Winnipeg seasons from both `club-stats-season/WPG` (Jets 2.0) and `club-stats-season/WIN` (Jets 1.0)
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

## GitHub Actions workflows

### Dataset update workflow

File:

- `.github/workflows/generate-wpg-players.yml`

This workflow:

- can be run manually via **workflow_dispatch**
- regenerates `data/wpg_players.json`
- commits and pushes updates automatically when the dataset changes

### GitHub Pages deploy workflow

File:

- `.github/workflows/deploy-pages.yml`

This workflow:

- deploys the static site to GitHub Pages on pushes to `main`
- can also be run manually via **workflow_dispatch**
