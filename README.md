# Winnipeg Jets Players Dataset

This project maintains a source-controlled JSON dataset of **every player who has appeared in at least one game for Winnipeg Jets franchise records (`WPG` + `WIN`)**, including both:

- skaters
- goalies

The dataset is generated from the NHL web API host:

- `https://api-web.nhle.com/v1/`

## Dataset output

Generated file:

- `data/wpg_players.json`
- `data/wpg_player_rookie_cards.json`

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

Each rookie card object includes:

- `playerId`
- `playerName`
- `isYG`
- `set`
- `cardNumber`

## Rookie card selection criteria

When populating `data/wpg_player_rookie_cards.json`, use this priority order for the player's primary rookie card:

1. **Modern era:** use the player's **base-set Upper Deck Young Guns** card when one exists.
2. **Vintage era (OPC years):** use the player's **base O-Pee-Chee** rookie card.
3. **Pre-OPC seasons:** use the player's **base Topps** rookie card.
4. **No Young Guns / ambiguous modern cases:** choose the most widely accepted mainstream rookie from the player's rookie season and keep choices consistent across the dataset.

Store only:

- whether it is a Young Guns (`isYG`)
- set name in `set`
- card number in `cardNumber`

The rookie card dataset is always kept aligned with `data/wpg_players.json`. When new players appear, entries are auto-added with default unknown values:

- `isYG: false`
- `set: ""`
- `cardNumber: ""`

## Web page

A static HTML page is included at the repository root:

- `index.html`

It loads player data dynamically from:

- `data/wpg_players.json`

The table is rendered in JavaScript (`app.js`) so the website does not duplicate the dataset in markup.

## Local rookie card editor

A local-only editor page is included at:

- `card-editor.html`

What it does:

- displays `data/wpg_player_rookie_cards.json` in an editable table
- allows in-browser editing of `isYG`, `set`, and `cardNumber`
- can save back to a local JSON file using the browser File System Access API (Chrome/Edge and other Chromium-based browsers)
- can always export a downloaded JSON copy as a fallback

Important limitations:

- this direct file-save flow does **not** work on GitHub Pages as an automatic repository write-back mechanism
- browser JavaScript cannot silently write to repository files on disk or in GitHub without explicit user interaction and additional backend/API plumbing
- for local editing, run a local static server and open `card-editor.html` in a compatible browser

Example local server:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/card-editor.html`.

## How generation works

The generator script:

- gets all available Winnipeg seasons from both `club-stats-season/WPG` (Jets 2.0) and `club-stats-season/WIN` (Jets 1.0)
- fetches season stats for game types:
  - `2` (regular season)
  - `3` (playoffs)
- merges skaters and goalies by player ID
- computes per-season and total GP values

Script locations:

- `scripts/generate_wpg_players.py`
- `scripts/generate_wpg_player_rookie_cards.py`

Run locally:

```bash
python scripts/generate_wpg_players.py
python scripts/generate_wpg_player_rookie_cards.py
```

## GitHub Actions workflows

### Dataset update workflow

File:

- `.github/workflows/generate-wpg-players.yml`

This workflow:

- can be run manually via **workflow_dispatch**
- regenerates `data/wpg_players.json`
- commits and pushes updates automatically when the dataset changes

### Rookie card dataset update workflow

File:

- `.github/workflows/generate-wpg-player-rookie-cards.yml`

This workflow:

- can be run manually via **workflow_dispatch**
- also runs on pushes to `main` when player/rookie-card dataset files or rookie-card generator workflow/script change
- regenerates `data/wpg_player_rookie_cards.json` from `data/wpg_players.json`
- preserves existing rookie card fields while auto-adding missing players with default blank/false values
- commits and pushes updates automatically when the rookie card dataset changes

### GitHub Pages deploy workflow

File:

- `.github/workflows/deploy-pages.yml`

This workflow:

- deploys the static site to GitHub Pages on pushes to `main`
- can also be run manually via **workflow_dispatch**
