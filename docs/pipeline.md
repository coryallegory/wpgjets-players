# Data pipeline

## Sources

- **NHL** (definitive): official stats (https://www.nhl.com/stats/, backed by
  `https://api-web.nhle.com/v1/`). `npm run get:nhl` runs `scripts/get-nhldata-jets.mjs` and writes
  `temp/reference/nhl-jets.json`.
- **WHA and other gaps**: no single source is authoritative. Consult several (NHL stats,
  Hockey-Reference, hockeydb, Eliteprospects) and reconcile best-effort; record the source(s) of each
  hand-curated or reconciled record. Ambiguous matches or source disagreements go to a review list
  for the owner; never resolved silently.
- One script per source, named for it, each writing its own file under `temp/reference/`.
- `npm run init:players` (`scripts/init-curated-players.mjs`) was the one-time NHL seed of
  `players.json`; it refuses to overwrite (`--force` only for deliberate regeneration, which would
  drop WHA data).

## WHA pipeline: COMPLETE, one-time

Scripts in `scripts/wha/`. **Agents: do NOT read `scripts/wha/*` (especially the very large
`reconcile-wha.mjs`) unless resolving a WHA review item or changing WHA data.** Everything needed for
normal work is below. All review items are resolved.

- Sources: Hockey-Reference (primary) and hockeydb (cross-check), via `get:hr-wha` and
  `get:hockeydb-wha` (one-time, cached in `temp/cache/`, polite scrapes; owner approved for personal
  offline use). Eliteprospects blocks scripts.
- `get:nhl-wha` looks WHA-only players up in NHL data by name + birth date
  (`temp/reference/nhl-wha-lookup.json`, cached in `temp/cache/nhl/`).
- Order: get:nhl-wha -> `reconcile:wha` -> `merge:wha`. Reconcile writes
  `temp/reference/wha-reconcile.json` and `wha-review.md`. Owner resolutions live in
  `data/decisions/wha-decisions.json`; reserved ids in `wha-ids.json`; extra name forms in
  `name-variants.json`.
- `merge:wha` merges into `players.json`: idempotent, refuses while review items are open unless
  `--allow-open`, has `--dry-run`. Expected output on the current data: "No changes."

## Keeping NHL data current

Routine: `npm run get:nhl` -> `npm run sync:nhl` (dry run, review the report) ->
`npm run sync:nhl -- --apply`. `scripts/sync-nhl-players.mjs` is network-free; it refuses if
`temp/reference/nhl-jets.json` is missing or older than 24h (`--allow-stale` to override).

- ADDED: players in the pull but not in `players.json` get the init:players record (source nhl.com).
  A new id matching an existing player by normalised lastName + birthDate is a CONFLICT and is not
  added (usually an existing record should move to that NHL id; or decide `add:<id>`).
- AUTO-UPDATED (owner decision, no approval): `nhl.seasons` rows of the two most recent seasons in
  the pull plus recomputed totals; "played" added to `qualifiedBy` on a first game (a null
  rookieSeason is then filled from nhl.com).
- NEEDS REVIEW (diff only): older season rows, firstName/lastName (name re-derived), country,
  birthDate, positions (never changed from other sources without approval), rookieSeason, draft,
  the "drafted" flag.
- Never deletes players (missing ones are reported) and never touches wha, notes, needsReview or
  source. `--apply` refuses while review items/conflicts are open; `--apply --allow-open` writes only
  the safe parts. The result must pass validation or nothing is written. Idempotent.

## Decision files (`data/decisions/`)

- `nhl-sync-decisions.json`: `{ id, resolution: "accept" | "keep-curated", note, value }` with ids
  `field:<playerId>:<field>`, `season:<playerId>:<season>:<team>`, `add:<playerId>`. keep-curated =
  permanent override (Gibson, Long; Labraaten dormant); `value` = the nhl.com value decided against
  (a new nhl.com value reopens it). Stale decisions warn.
- `wha-decisions.json`: owner resolutions of WHA review items. `wha-ids.json`: reserved WHA ids,
  append-only. `name-variants.json`: extra name forms recorded in notes.

## Checks

`npm run validate` (schema/integrity), `npm test` (node:test in `tests/`; must pass in a clean
checkout without `temp/`). The pre-commit hook (`npm run setup:hooks`, `.githooks/pre-commit`) runs
validate when `site/data/curated/` or `data/decisions/` files are staged; the Pages deploy runs both.
