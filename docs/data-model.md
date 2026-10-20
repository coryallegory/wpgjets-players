# Data model

## Layers

1. **Curated data** (source of truth) in `site/data/curated/`: `players.json`, later `cards.json`,
   `collection.json`, `prices.json`, all keyed by `playerId`. Published with the site. Changed only
   deliberately (by hand or by a reviewed script), never silently overwritten.
2. **Reference data** in `temp/reference/` (outside `site/`, gitignored, rebuildable): raw data
   pulled from external sources by scripts. It is compared against and considered for updating the
   curated files; it is not published.

Hand-made decisions that scripts honour live in `data/decisions/` (see [pipeline.md](pipeline.md)).

## Curated player fields (schema v2)

`playerId`, `firstName`, `lastName`, `name` ("Last, First", derived from the separate fields, never
parsed), `country`, `birthDate`, `positions`, `rookieSeason`, `nhl` (Jets 1.0/2.0 GP totals plus
per-season rows, always present), optional `wha` (WHA Jets totals, per-season rows, own
non-definitive `source`), `draft`, `qualifiedBy`, `source`, optional `notes` and `needsReview`.
Validation lives in `scripts/validate.mjs`.

- **Seasons** are a list of per-season rows per player, not just first/last year.
- **Positions**: if a player held multiple positions, decide per-season vs. list when the first real
  case is encountered; whatever is chosen must use the same format for every player. Players who
  never played have no position (accepted by the owner).
- **Draft**: any team's pick. Year, team, overall pick required; round and amateur team nice to have
  (`amateur` = team (league)). Country of origin is nice to have.
- **Provenance**: every curated player has a `source` object saying whether the record came directly
  from nhl.com (definitive) or from elsewhere (and which site/URL). WHA-derived facts carry a `source`
  that is not definitive.
- **notes**: provenance and corrections. Where sources disagree, notes record it. Alternate birth
  dates are kept in `notes`. The NHL layer's own errors can be corrected by reviewed decisions
  (e.g. Gibson and Long birth dates).
- **needsReview**: marks provisional fields.
- `birthDate` (ISO) is required and is the key for matching people across sources; never match on
  names alone (shared surnames, Rob/Robert, Doug/Douglas).

## Ids

`playerId` is the real NHL id whenever the player has an NHL record/career (including WHA players
who played in the NHL elsewhere). Ids 900000-999999 are reserved for WHA Jets players who never
played in the NHL (they start at 900001). `data/decisions/wha-ids.json` is append-only; an id retired
in favour of a real NHL id records `retiredFor` and is never reused.

## rookieSeason

The first MAJOR-LEAGUE regular season: the earliest NHL or WHA regular season on any team (the owner
counts a WHA rookie year as the true big-league rookie season). Null only for players who never
played in either league. With no NHL career it comes from Hockey-Reference's career table (or the
first WHA Jets season), with a note saying which.

## WHA scope

A WHA player qualifies with >= 1 regular-season or playoff game for the WHA Winnipeg Jets (1972-73
to 1978-79). Playoff-only players count. Preseason games are never counted. All eras share a single
`players.json`.

## cards.json (decided rookie cards only)

`site/data/curated/cards.json`: an object keyed by `playerId`. **Only decided players have a record**
(undecided = no key; players who never played a major-league game never get one). Written by
`npm run import:cards`, checked by `scripts/validate.mjs`.

- `status`: `chosen` or `no-card` (owner decided no rookie card exists).
- `chosen`: the card, or `null` for `no-card`. Fields: `set` (with year, e.g. "2011 Upper Deck"), `year`,
  `season` (e.g. "2011-12"), `brand`, optional `subset` ("Young Guns"), `cardNumber` (string),
  optional `serialNumbered` (e.g. "/999"), `variant`, `sourceIds` ({ scp, comc }), `urls` ({ scp, comc };
  reference links only, never images or prices; optional, a few verified cards have no page).
- `rule`, `confidence` (high/medium/low, at decision time), `source`, `checkedOn` (date the baseline
  checked): required for `chosen`, optional for `no-card`. `reason` and `note` (owner's note) optional.
- `decidedOn` (date), `decidedBy` (`owner`), `basis`: `owner-verified-young-guns`
  (data/decisions/young-guns-verified.json; the card must match its season and number),
  `owner-confirmed` (Hull, Selanne) or `page-approval` (review page).
- Ranked candidates are not stored here (they stay in `temp/reference/cards-baseline.json` and the
  review page).
