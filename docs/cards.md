# Cards, collection and prices (phases 2-4)

## Phase 2: target rookie card

One per player: the de facto flagship rookie card, not the rarest. Precedence:

1. Modern era: base-set Upper Deck Young Guns.
2. Otherwise the set/brand generally regarded as the standard for that era: O-Pee-Chee in the 1990s
   and earlier; Parkhurst or Topps before OPC existed. OPC is always preferred over Topps when both
   exist (OPC has the higher pedigree head to head).
3. If nothing fits, pick the closest defensible option and record why.

Record the card **set** (year + manufacturer/brand), **card number**, and whether it is **serial
numbered** (e.g. /100). Where the choice is unclear, store a **ranked list of candidates** and mark
which is chosen. If no rookie card exists, record that explicitly (null card / "no card exists"); do
not leave it blank.

Process (owner priority): card review is ongoing. Agents produce a baseline first pass; owner and
agent tune it over time, mostly for players without a Young Guns card. A pilot comes first to settle
the approach and how edge cases are recorded, after a source survey.

## Phase 3: collection status

Whether the owner has the card or is still looking for one. Edited as JSON and committed.

## Phase 4: market price

Raw (ungraded) prices, ultimately from eBay recent sold listings, possibly via aggregators such as
sportscardspro.com.

## Phase 2 plan and status (next up)

Status: not started. Phase 1 is complete (tag `phase-1-complete`). Agreed order of work:

1. **Source survey** (read-only, nothing written to the repo). An agent investigates where card
   data can be found and how accessible it is, then reports before anything is built. Candidates
   named by the owner: sportscardspro.com (may flag rookie cards), COMC, Beckett and Upper Deck
   checklists (if the data is accessible online); also look for others (e.g. Trading Card
   Database). For each source report: what data and ids it exposes, whether it flags rookie cards,
   accessibility to scripts, terms of use, and coverage for vintage and WHA-era players (the hard
   cases). Anything behind a login or paywall is manual-only. Recommend which sources to use for
   which era and what the card record should look like.
2. **Pilot** on a small, varied set (about 10 players, proposed by the agent and confirmed by the
   owner): a current Jets player or two, some modern Young Guns, a 1990s player, a vintage player, a
   WHA-only player, and a recent draft pick with no card yet. Purpose: settle the approach and how
   edge cases and problems are recorded.
3. **Baseline first pass for all players** by agents, then ongoing review and tuning with the owner.
   Long-term most review effort is for players without a Young Guns card.

Intentions to keep in mind:

- Rookie card = the flagship/standard card for the era, not the rarest. WHA-only players may have
  few or no mainstream rookie cards: "no card exists" is a valid recorded outcome.
- A player's `rookieSeason` (first NHL or WHA season on any team) is the starting point for finding
  the card; `name` variants in `notes` help searching.
- Recent NHL draft picks matter: surface them (and their cards) so the owner can watch for
  prospects before they reach the Jets roster. A prospects view on the site is a likely later
  addition.
- Record where each card choice came from (source and confidence), so it can be re-reviewed.

## Not yet decided

- The `cards.json`, `collection.json` and `prices.json` schemas (the pilot informs these).
- The price-collection method.
- Which pilot players to use, and any sites where scripted access should be avoided.
