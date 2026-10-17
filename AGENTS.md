# AGENTS.md

Guidance for AI coding agents working in this repository.

**State of play:** phase 1 (player list) is complete and tagged `phase-1-complete`. Next: phase 2
(target rookie cards): source survey, then a pilot, then a baseline for all players. The plan and
open questions are in [docs/cards.md](docs/cards.md); start there.

## Goal

A **personal Winnipeg Jets rookie card collection tracker** (sole audience: the repo owner). It
tracks every player tied to a Winnipeg Jets franchise and the single rookie card the owner wants
for each, whether it is collected, and its market price.

Qualifying players (a player needs only one):

- **Dressed/played:** at least one regular season or playoff game (GP >= 1) for any of:
  WHA Winnipeg Jets (1972-79), NHL Jets 1.0 (1979-96, API code `WIN`), NHL Jets 2.0 (2011-present,
  API code `WPG`). Preseason games never count.
- **Drafted:** selected by a Winnipeg Jets franchise (the team that held the pick) in an NHL draft,
  even if they never played for the Jets. WHA drafts are out of scope.

## Owner priorities

- Phase 2 is an ongoing review process: agents produce a baseline first pass, owner and agent tune it
  over time (mostly players without a Young Guns card). Pilot first to settle the approach and how
  edge cases are recorded.
- WHA-era draft details are not a priority. Recent NHL draft picks (past few years) matter: they
  help anticipate who reaches the Jets roster and when to watch for their rookie cards.
- Add tooling only when it meaningfully improves efficiency, accuracy or organization.

## Phases

1. **Player list** - qualifying players with name, seasons, positions, draft info. Done.
2. **Target rookie card** - one flagship rookie card per player (not the rarest). Rules: [docs/cards.md](docs/cards.md).
3. **Collection status** - whether the owner has the card or is still looking.
4. **Market price** - raw (ungraded) prices, ultimately from eBay sold listings.

Only a **single rookie card per player** is in scope.

## Key technical decisions

- **Static site in `site/`**: plain HTML/CSS/JS, no build step, no server; deployed to GitHub Pages
  by `.github/workflows/deploy-pages.yml` (tests and validation gate the deploy). Nothing outside
  `site/` is published. Site code: pure logic in `site/js/lib/` (no DOM, unit tested), DOM code in
  `site/js/`; build DOM with `textContent`/`createElement`, never `innerHTML` with data.
- **Scripts are Node.js 22, no third-party dependencies** (`fetch`, `node:test`). One script per
  source in `scripts/`, writing its own file under `temp/reference/`.
- **Curated vs reference data**: curated JSON in `site/data/curated/` is the source of truth,
  committed and published, changed only deliberately. Reference data in `temp/reference/` is raw,
  gitignored and rebuildable. Details: [docs/data-model.md](docs/data-model.md).
- **Collection status** is edited as JSON and committed. Fresh start: build all data from scratch.
- Default branch is **`main`**.
- NHL data (nhl.com) is definitive; elsewhere reconcile several sources best-effort and record the
  source. Ambiguities go to the owner for review, never resolved silently. See [docs/pipeline.md](docs/pipeline.md).

## Working agreements

- Discuss plans with the owner before implementing large changes.
- Keep this file and `docs/` current as decisions are made.
- Add tooling only when it meaningfully helps.
- Run `npm run setup:hooks` once per clone: the pre-commit hook runs `npm run validate` when
  curated data or decision files are staged.

## Commands

Details live in `package.json`; behaviour and rules in [docs/pipeline.md](docs/pipeline.md).

| Command | Purpose |
|---|---|
| `npm run get:nhl` then `npm run sync:nhl` | Refresh NHL data (dry run; `-- --apply` to write) |
| `npm run validate` / `npm test` | Data checks / tests |
| `npm run serve` | Local preview at http://localhost:8000 |
| `npm run setup:hooks` | Enable the pre-commit validation hook |
| `get:hr-wha`, `get:hockeydb-wha`, `get:nhl-wha`, `reconcile:wha`, `merge:wha`, `init:players` | One-time WHA/seed pipeline (complete) |

## Docs

- [docs/data-model.md](docs/data-model.md) - curated schema, ids, rookieSeason, layering
- [docs/pipeline.md](docs/pipeline.md) - sources, scripts, NHL refresh routine, decision files
- [docs/cards.md](docs/cards.md) - phase 2-4 rules and open decisions

## Legacy

`legacy/` holds the previous implementation (old table site, card editor, Python generators, JSON
data). Reference only: read it for ideas and data (e.g. hand-entered card info in `legacy/data/`),
but do not build on or edit it unless asked. Do not import its card entries; the owner will compare
the datasets later.
