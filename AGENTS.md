# AGENTS.md

Guidance for AI coding agents working in this repository.

## Goal

A **personal Winnipeg Jets rookie card collection tracker** (sole audience: the repo owner). It
tracks every player tied to a Winnipeg Jets franchise and the single rookie card the owner wants
for each, whether it is collected, and its market price.

Qualifying players (a player needs only one):

- **Dressed/played:** at least one regular season or playoff game (GP â‰¥ 1) for any of:
  - WHA Winnipeg Jets (1972-79)
  - NHL Jets 1.0 (1979-96, API code `WIN`)
  - NHL Jets 2.0 (2011-present, API code `WPG`)
- **Drafted:** selected by a Winnipeg Jets franchise (the team that held the pick) in an NHL draft,
  even if they never played for the Jets. WHA drafts are out of scope.

## Phases

1. **Player list** â€“ assemble qualifying players. Primary source: official NHL stats
   (https://www.nhl.com/stats/, backed by `https://api-web.nhle.com/v1/`). Per player: full name,
   seasons played with the Jets, position, and draft info (year, team, overall pick/order).
2. **Target rookie card** â€“ one per player: the de facto flagship rookie card, not the rarest.
   Precedence:
   1. Modern era: base-set Upper Deck Young Guns.
   2. Otherwise the set/brand generally regarded as the standard for that era: O-Pee-Chee in the
      1990s and earlier; Parkhurst or Topps before OPC existed. OPC is always preferred over Topps
      when both exist (OPC has the higher pedigree head to head).
   3. If nothing fits, pick the closest defensible option and record why.
   Record the card **set** (year + manufacturer/brand), **card number**, and whether it is
   **serial numbered** (e.g. /100). Where the choice is unclear, store a **ranked list of
   candidates** and mark which is chosen. If no rookie card exists, record that explicitly
   (null card / "no card exists"); do not leave it blank.
3. **Collection status** â€“ whether the owner has the card or is still looking for one.
4. **Market price** â€“ raw (ungraded) prices, ultimately from eBay recent sold listings, possibly via
   aggregators such as sportscardspro.com.

Only a **single rookie card per player** is in scope.

## Technical decisions

- **Published site lives in `site/`** and is deployed to GitHub Pages by `.github/workflows/deploy-pages.yml` (Pages source: GitHub Actions). Nothing outside `site/` is published.
- **Static website**: plain HTML/CSS/JS, no build step, no server required. It must work when
  hosted statically (GitHub Pages) and ideally opened locally.
- **Data is produced by local scripts** and committed to git alongside the site assets. The site
  only reads and displays committed data.
- **Scripts are Node.js (JavaScript)**, no third-party dependencies where practical (Node 22 has
  `fetch` and `node:test`).
- **Collection status is edited as JSON and committed** (by hand or by a local script).
- Default branch is **`main`**.

## Decisions on sources and scope

- **WHA and other gaps**: no single source is authoritative. Consult several (NHL stats,
  Hockey-Reference, hockeydb, Eliteprospects) and reconcile on a best-effort basis; record the
  source(s) for each hand-curated or reconciled record.
- **Fresh start for data**: build all data from scratch. Do not import card entries from
  `legacy/data/`; the owner will compare the datasets later.
- **First version of the site**: a sortable table.

## Data model decisions

- **Seasons** are stored as a list per player (e.g. 1990-91, 1991-92), not just first/last year.
- **Position**: if a player held multiple positions, decide per-season vs. list when the first real
  case is encountered. Whatever is chosen must use the **same format for every player**.
- **Draft**: year, team, overall pick required; round and amateur team nice to have.
- **Country of origin**: nice to have.
- **Two layers of JSON data**:
  1. *Curated data* (source of truth) in `site/data/curated/`: `players.json`, later `cards.json`,
     `collection.json`, `prices.json`, all keyed by `playerId`. Published with the site. Changed only
     deliberately (by hand or by a reviewed script), never silently overwritten.
  2. *Reference data* in `temp/reference/` (outside `site/`, gitignored, rebuildable): raw data
     pulled from external sources by scripts. It is compared against and considered for updating the
     curated files; it is not published.
- **One script per source** in `scripts/`, named for its source (e.g. `get-nhldata-jets.mjs`).
  Each writes its own file under `temp/reference/`.
- **Provenance**: every curated player has a `source` object saying whether the record came
  directly from nhl.com (definitive) or from elsewhere (and which site/URL).
- **Local preview**: the site uses JavaScript, so provide a tiny dependency-free Node static server
  (e.g. `npm run serve`) to test it locally.

## WHA decisions

- A WHA player qualifies with >=1 regular-season or playoff game for the WHA Winnipeg Jets
  (1972-73 to 1978-79). Playoff-only players count. **Preseason games are never counted.**
  WHA drafts are out of scope.
- Single `players.json` for all eras (many players span WHA and NHL). WHA-derived facts carry a
  `source` that is not definitive.
- Sources: Hockey-Reference (primary) and hockeydb (cross-check) via `scripts/get-hockeyreference-wha.mjs`
  and `scripts/get-hockeydb-wha.mjs` (one-time, cached, polite scrapes; owner approved for personal
  offline use). Eliteprospects blocks scripts. Both write 88 players to `temp/reference/`.
- `birthDate` (ISO) is a required profile field and the key for matching people across sources;
  never match on names alone (shared surnames, Rob/Robert, Doug/Douglas).
- WHA-only players get IDs from a reserved range (900000+). Players also in the NHL data keep
  their NHL `playerId`.
- Ambiguous matches or source disagreements go to a review list for the owner; they are never
  resolved silently.

## Current state and commands

Phase 1 (player list) is done: 676 players (602 from NHL data, 74 WHA-only). The site is a sortable
table of `players.json`. Four WHA birth dates are provisional (`needsReview`) pending owner review.

- `npm run get:nhl` – `scripts/get-nhldata-jets.mjs` -> `temp/reference/nhl-jets.json`
- `npm run get:hr-wha`, `npm run get:hockeydb-wha` – WHA pulls (cached in `temp/cache/`)
- `npm run reconcile:wha` – matches WHA data against the NHL layer; writes
  `temp/reference/wha-reconcile.json` and `wha-review.md`. Owner resolutions live in
  `data/decisions/wha-decisions.json`; reserved WHA ids in `data/decisions/wha-ids.json`
- `npm run merge:wha` – merges WHA data into `players.json` (idempotent; refuses while review
  items are open unless `--allow-open`; `--dry-run` available)
- `npm run init:players` – one-time NHL seed of `players.json`; refuses to overwrite (`--force`
  only for deliberate regeneration; it would drop WHA data, so re-run merge afterwards)
- `npm run validate` – schema/integrity checks (`scripts/validate.mjs`)
- `npm test` – node:test suites in `tests/`
- `npm run serve` – local preview at http://localhost:8000

Curated player fields (schema v2): `playerId`, `firstName`, `lastName`, `name` ("Last, First",
derived from separate fields, never parsed), `country`, `birthDate`, `positions`, `rookieSeason`
(first NHL season on any team; null if never in the NHL), `nhl` (Jets 1.0/2.0 GP totals plus
per-season rows, always present), optional `wha` (WHA Jets totals, per-season rows, own non-definitive
`source`), `draft` (any team's pick; `amateur` = team (league)), `qualifiedBy`, `source`, optional
`notes` (provenance/corrections) and `needsReview` (provisional fields). WHA-only players have ids
900001+. Where sources disagree, notes record it; the NHL layer's own errors can be corrected by
reviewed decisions (e.g. Gibson and Long birth dates).

Site code: pure logic in `site/js/lib/` (no DOM, unit tested), DOM code in `site/js/`. Build DOM
with `textContent`/`createElement`, never `innerHTML` with data.

## Not yet decided

Resolving the four provisional WHA birth dates (Gratton, Hicks, Labraaten, Powis), `cards.json` / `collection.json` / `prices.json` schemas, and
the price-collection method. Known gap: drafted-only players have no position (NHL club stats
only carry positions for players who played).

## Legacy reference

The previous implementation lives in `legacy/` (old table site, card editor, Python NHL API
generators, JSON data). It is **reference only**: read it for ideas and data (e.g. hand-entered
card info in `legacy/data/`), but do not build on or edit it unless asked.

## Working agreements

- Discuss plans with the owner before implementing large changes.
- Keep this file current as decisions are made (stack, schemas, commands).
