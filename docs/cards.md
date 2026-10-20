# Cards, collection and prices (phases 2-4)

## Phase 2: target rookie card

One per player **who played for a Jets franchise** (Jets GP on the site). Drafted-never-played
players are tracked but are not collection targets until they play a Jets game. The de facto flagship rookie card, not the rarest. Precedence:

Ranking rules by rookie season (full detail in "Ranking rules" below): through 1988-89 OPC leads (then Topps,
then Parkhurst for the earliest years); 1989-90 to 1998-99 is contested and always shown as ranked options
for review; from 1999-2000 on the Upper Deck Young Guns leads when one exists. If nothing fits, pick the
closest defensible option and record why.

Record the card **set** (year + manufacturer/brand), **card number**, and whether it is **serial
numbered** (e.g. /100). Where the choice is unclear, store a **ranked list of candidates** and mark
which is chosen. If no rookie card exists, record that explicitly (null card / "no card exists"); do
not leave it blank.

Process (owner priority): card review is ongoing. Agents produce a baseline first pass; owner and
agent tune it over time, mostly for players without a Young Guns card. A pilot comes first to settle
the approach and how edge cases are recorded, after a source survey.

### Ongoing workflow (owner decisions 2026-10-19)

Card review is ongoing; **only decided cards enter `cards.json` and the table** (schema in
[data-model.md](data-model.md)). Table column "Rookie Card": the card (linked to its SportsCardsPro or
COMC page) once decided; "No card" for an explicit no-card decision; "?" for a player with Jets games
who is still undecided, linking to the review page opened on that player (`#<playerId>`); blank for
drafted-never-played players. Players without a designated rookie card stay open on the review page
and are approved there; then run the import routine ([pipeline.md](pipeline.md)). The review page
reads `#<playerId>` in its URL, clears filters hiding that player and scrolls to the card (the page is
generated from `temp/review/template.html` + `make-data.mjs`).

**Privacy:** the review artifact's URL is in the public site source (`REVIEW_URL` in
`site/js/lib/format.js`) and it holds the owner's decisions, so it must stay private/unshared (never
use a share setting).

## Phase 3: collection status

Whether the owner has the card or is still looking for one. Edited as JSON and committed.

## Phase 4: market price

Raw (ungraded) prices, ultimately from eBay recent sold listings, possibly via aggregators such as
sportscardspro.com.

## Phase 2 plan and status (next up)

Status: source survey done (2026-10-17), pilot next. Phase 1 is complete (tag `phase-1-complete`). Agreed order of work:

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
   WHA-only player, and a recent draft pick (tracked only, to settle how non-targets are shown). Purpose: settle the approach and how
   edge cases and problems are recorded.
3. **Baseline first pass for all players who played** by agents, then ongoing review and tuning with the owner.
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

- The `collection.json` and `prices.json` schemas (`cards.json` is defined in data-model.md).
- The price-collection method.
- Which pilot players to use, and any sites where scripted access should be avoided.

## Source survey outcome and decisions (2026-10-17)

- **Primary scripted source: SportsCardsPro** (sportscardspro.com). Server-rendered search and
  product pages, robots.txt allows crawling, rows carry product id, card number, set, `[RC]` flag,
  serial numbering and prices. Owner approved polite scraping (2s+ delay, cache under
  `temp/cache/`, output under `temp/reference/`). Their paid API is the sanctioned alternative.
- Caveats: search is fuzzy (match on name + year range + set, never trust blindly); `[RC]` is not
  reliable on vintage/WHA rows (apply "earliest card in the flagship set" ourselves); Young Guns is
  the `[RC]` row of a base Upper Deck set, excluding Jumbo/Acetate/Renewed reissues and
  parallels. Hull's first card is likely the 1957 Parkhurst (check manually).
- TCDB, Beckett and Cardboard Connection are Cloudflare/paywall blocked: manual verification only.
  COMC is a marketplace (not a checklist; robots signals no AI training use). eBay is never scripted.
- **Players who never played an NHL or WHA game get no card record** at this stage (owner decision);
  they are not part of the rookie card hunt. Records are only for players with major-league GP.
- Card record shape: `status` (`chosen` / `no-card` / `needs-review`), `chosen` card (set, year,
  brand, subset, cardNumber, serialNumbered, rookieFlag, sourceIds, url), ranked `candidates`,
  `rule`, `confidence`, `source`, `checkedOn`, `reason` (required for no-card/edge cases), `reviewed`.
- Pilot (10): Scheifele, Connor, Elias Salomonsson (recent Jets debut, 2025-26), Viggo Bjorck
  (2026-27 debut, tests card not yet released), Hawerchuk, Selanne, Hull, Hedberg, Nilsson,
  plus one WHA-only player with probably no card (Brian Cadle, 900014).

## Pilot review decisions (2026-10-18)

- **Confidence ladder**: every chosen card has a confidence (high/medium/low). If the first choice is
  not high, list a second option with its own confidence; if that is not high either, list a third.
  So the owner reviews at most three ranked options per player. Stop adding options once one is high.
- **Hull** confirmed by the owner: 1958-59 Topps #66 is the rookie card (no 1957 Parkhurst exists).
- **Selanne** confirmed by the owner: 1991-92 Upper Deck #21 is the rookie card even though the
  Young Guns card came a year later. Young Guns were not yet an established benchmark in the early
  Upper Deck years, so "Young Guns first" applies only once Young Guns were an established
  benchmark. The cutoff is now set, see the next section.

## Ranking rules (2026-10-19, supersede the 2005-06 cutoff and the 1990s OPC rule)

Young Guns is a candidate in **every** era where one exists (e.g. Selanne and Zhamnov, 1992-93); the era
rules below only decide which option ranks first. Confidence ladder: up to 3 ranked options, each with its
own confidence, stop at the first high. The "first card is late" check is 3 or more seasons after
rookieSeason (a card 2 seasons late is accepted with at most medium confidence).

- **Through rookie season 1988-89**: OPC leads, then Topps, then Parkhurst (before OPC existed in 1968).
  Auto-pick; review only if the first card is 3+ seasons late or nothing is found.
- **1989-90 to 1998-99 (contested)**: ranked options = first Upper Deck card, Young Guns where it exists,
  OPC / OPC Premier (only where an OPC set existed), SP / SP Authentic, other sets. Confidence is capped at
  medium unless owner-verified, and the options are always shown for review. If the first Upper Deck card
  is 2+ seasons later than another flagship option, the earlier card leads. Owner-confirmed: Selanne 1991-92
  UD #21 stays; Hull stays (both locked).
- **1999-2000 on**: Young Guns leads when one exists (the owner-verified list overrides everything).
  Young Guns detection: base-set Upper Deck number blocks (1992-93 #555-599, 2000-01 #181-230, 2001-02
  #181-211, 2002-03 #196-240, from 2003-04 #201-250 / #451-500 / #701-750); for 1993-1999 only SCP's [RC]
  flag is available ("possible Young Guns"). The 2005-06 Rookie Rule (a played NHL game is required) still
  governs the name-collision check: pre-debut cards are legitimate before 2005-06.
- **Modern players with no Young Guns**: fallback order is base-set rookie cards first (Upper Deck Rookie
  Class / Update, a Series base [RC], an OPC [RC]), then other rookie cards (Artifacts, Parkhurst, Bee Hive,
  Victory, MVP, SP, ...), and autograph / patch / serial-numbered premium cards (SP Authentic Future Watch
  Auto, The Cup, Hot Prospects, Ultimate Collection, ...) only as a last resort when nothing else exists,
  labelled "Premium fallback" in the why/variant.
- **OPC production** (from the crawled SCP set lists): continuous 1968-1992, none 1993-1998, sporadic
  1999-2003, none 2004-05, Upper Deck revival from 2006. So no OPC card after 1993 never triggers review;
  the Upper Deck, SP and other options are ranked directly.

### Wide candidate search

The 100-row SCP name search misses sets (e.g. Andrew Ladd's 2005 Upper Deck Rookie Class #23), so candidate
finding now also crawls whole SCP set pages ("consoles", 150 rows each, POST paging) for the OPC, Topps,
Parkhurst, Upper Deck family (base, Rookie Class/Update, Victory, MVP, Bee Hive, Ice, Artifacts, Black
Diamond, Trilogy, SP / SP Authentic, The Cup, ...) and other 1989-95 brands, for the season window
rookieSeason-1 to +3 of every non-locked player. `scripts/get-cards-wide-crawl.mjs` does the crawl
(set list: `scripts/cards-wide-sets.mjs`, slugs from the SCP brand pages and cached search results;
resumable, results in `temp/cache/scp-wide/index.jsonl`, 2.5s delay, curl). 2019+ sets are crawled too since 2026-10-19 (see the set coverage audit). `get-cards-baseline-build.mjs` merges the crawled rows
with the name-search rows offline and applies the rules above; re-run it after any rule change.

Baseline after the 2026-10-19 rebuild (495 players): chosen 188 high + 102 medium; no-card 74 (medium);
needs-review 5 medium + 115 low + 11 with no candidates (4 of those are unreleased 2026-27 cards or
unlisted names). Owner review happens on a private published review page; approvals are imported into
`site/data/curated/` afterwards.

## First-year rule and re-ranking (2026-10-19, supersedes the contested-era and fallback ranking above)

**First-year rule (every era).** The flagship rookie card must come from the first season in which cards of the
player exist. Per player, the earliest card season among eligible cards (a recognised set from the audited family
list, not a parallel/variant, not a reprint, not a minor-league/junior/oddball/Classic set) is the first card year;
the candidate pool is restricted to that season and ranked only within it. Later-year cards are never options (the
`reason` may mention that one exists). The lower bound is rookieSeason-1 (2005-06 and later rookies: rookieSeason,
because of the Rookie Rule). A first card 3+ seasons after rookieSeason stays `first-card-late` (needs-review, low).
Example, Nik Antropov (rookie 1999-00): the old baseline put 2000 O-Pee-Chee #163 first; it is now impossible
because 2000 is later than his first card year 1999. His 1999-00 options are 1999 Topps Chrome #297 (what SCP calls
the 1999-00 O-Pee-Chee Chrome set), 1999 Upper Deck Black Diamond #83 and 1999 SP Authentic #118 (no 1999 base OPC or
Upper Deck card of his exists on SCP).
Exceptions that stay: the owner-verified Young Guns list, Hull and Selanne (1991-92 UD #21 is also his first card
year; his 1992-93 Young Guns is later and therefore not a flagship option by this rule). A Young Guns in a later year
than the first card is flagged in `reason`; for 2005-06+ rookies, and for a verified one on a 1999-2004 rookie, it is
kept as the owner-decides case (rules `modern-young-guns-later` / `verified-young-guns-later`); for earlier rookies it is
only mentioned.

**Ranking inside the first year.**
- Through 1988-89: OPC, then Topps, then Parkhurst (unchanged), within the first card year.
- 1989-90 to 1998-99: OPC and OPC Premier are the core pool (O-Pee-Chee, O-Pee-Chee/Topps Premier, 1998 OPC Chrome).
  OPC leads where an OPC-family card exists in the first card year; Upper Deck (Young Guns / [RC] first), a second OPC
  family card, SP, Pinnacle, Score, Fleer, Ultra, Leaf, Parkhurst, Bowman etc. are alternates. The first Upper Deck card no
  longer leads automatically. No OPC base set existed after 1993-94, so UD/SP/other rank directly there. Confidence
  capped at medium (unless owner-verified). Players whose first Upper Deck card is in an EARLIER year than the first
  OPC-family card are listed for the owner (9: Blomsten, Arto; Borsato, Luciano; Draper, Kris; Kaminsky, Yan; Roussel, Dominic; Thompson, Brent; Tkachuk, Keith; Ulanov, Igor; Zhamnov, Alexei); the first-year rule makes the earlier UD card eligible and drops the later OPC card.
- 1999-2000 on: Young Guns (in the first card year) leads; else base-set rookies (Rookie Class, Series base [RC], OPC
  rookie incl. Chrome), then other cards; premium autograph/patch/numbered cards last, but shown as a "Premium fallback"
  option when fewer than 3 non-premium options exist.
- Ladder unchanged: up to 3 options, stop at the first high.
- Players with only non-flagship rows (Flood, Mannino, Kosmachuk and others) are left for the owner's review as is.

## Set coverage audit (2026-10-19)

`scripts/cards-wide-sets.mjs` was audited against every hockey set slug on SCP (brand pages upper-deck, topps, fleer,
score, panini, other-cards, plus set slugs seen in cached searches; OPC, Parkhurst, Pinnacle and Pro Set have no brand
page of their own). The miss behind Antropov: only `o-pee-chee`, `-wha` and `-premier` counted as OPC; OPC Chrome,
Platinum, Update, Retro, Topps OPC and Topps Chrome (SCP's name for the 1999-2002 Chrome sets) did not. Added families:
OPC Chrome / Platinum / Update / Retro / Topps OPC / Topps OPC Premier / Topps Chrome; Topps Premier Plus, Gold Label,
Heritage, Total, Pristine, Stars, Reserve, Traded, Finest; Parkhurst SE / Vintage / Champions / Prominent Prospects;
Upper Deck Choice, Pros & Prospects, Special Edition, Gold Reserve, PowerDeck, Retro, Vintage, Champ's, Parkhurst,
Collector's Choice, UD3, Power Play, Ovation, Honor Roll, Allure, Clear Cut, Credentials, Engrained, Overtime, Stature,
Victory MVP, UD Portraits, Beehive; premium Premier, Synergy, Black, Sweet Shot, Rookie Threads, Ultimate Victory,
SP Game Used, SPx Finite, SP Premier, SP Authentic updates, Ultimate Collection updates; Pinnacle Be a Player / Beehive /
Certified / Inside / Mint / Summit / Totally Certified, Be a Player, Zenith, Donruss Elite / Canadian Ice / Limited /
Preferred / Studio, Leaf Limited / Preferred / Metal / Ultimate, Fleer Metal / Power Play / Retro, Skybox Metal Universe /
E-Motion, Score Rookie & Traded, Bowman Young Stars, Flair, Select, Collector's Edge Ice, the Pacific family (Crown Royale,
Dynagon, Invincible, Omega, Paramount, Revolution, Aurora, Prism, Private Stock, Vanguard, Adrenaline, Heads Up, Atomic,
Calder, Exclusive, Maximum Impact, Quest for the Cup, ...) and the Panini 2010-13 base sets. Deliberately excluded: inserts,
parallels, stickers, reprints, CHL/AHL/PWHL, ITG Heroes & Prospects, Classic, Bowman CHL, oddball regional sets.
The previously skipped 2019+ sets (Victory, MVP, Ice, Black Diamond, Artifacts, Allure, Clear Cut, ...) are now crawled
too. The crawl covers the whole index (781 sets, about 640k rows).

## Owner-verified Young Guns (2026-10-19)

`data/decisions/young-guns-verified.json` lists 121 Upper Deck base-set Young Guns the owner verified
from their own collection records (playerId, season, card number). `get-cards-baseline-build.mjs`
applies it as an override: the card is matched to its SportsCardsPro row by set year and card number
(if SCP has no row, the candidate comes from the decision file with no SCP id). For rookieSeason
1999-2000 or later it becomes the chosen card (high, rule `verified-young-guns`, `reviewed: true`, shown
as "Confirmed earlier / owner-verified" on the review page). Effect on the 495-player baseline: chosen/high 127 -> 194, and several
needs-review picks (Setoguchi, Tlusty, Halischuk, Kulikov, Lambert, Montoya, Hutchinson, Dubois,
Appleton, Toninato, Brooks, Kovacevic) are resolved. 120 of the 121 are Jets-GP targets; Rutger
McGroarty is drafted-only, so his entry is stored but has no card record yet.

## COMC as a supplementary source (2026-10-19)

COMC (comc.com) is a marketplace, not a checklist: it is used only as a **supplementary verification and candidate
source**. Pass 1 covered the roughly 200 players with the weakest SCP results (no-card, needs-review, no candidates); pass 2 (2026-10-19) extends it to every player with Jets GP who is not locked (Hull, Selanne) and not in the owner-verified Young Guns list, i.e. also the chosen/medium, needs-review/medium and chosen/high players (373 players checked in total, 175 further requests). Rules of use:
low volume (3s+ delay, cached under `temp/comc/`, only `/Players/` and `/Cards/` pages), **reference links only, never
images or prices**, and an empty COMC page proves nothing (COMC lists only cards it has stock of, so "no card" is never
concluded from COMC alone; it only "supports" a no-card finding). Findings: `temp/comc/comc-findings.json` (200 players:
102 new candidates, 74 supports-no-card, 24 inconclusive).

Integration (`scripts/cards-comc-merge.mjs`, called by `get-cards-baseline-build.mjs`, so a rebuild keeps it): each eligible
COMC first-year card becomes an extra candidate (source `comc`, `comcUrl`, label "Found on COMC", no SCP id) and goes through
the same first-year rule and ranking as SCP rows. Same season + set + card number as an SCP row is the same card: the SCP id
is kept, the `comcUrl` is added and the card is marked "confirmed on COMC" (confidence up one step when both sources carry the
RC flag, never above the era cap). Set names are compared literally: COMC "O-Pee-Chee Chrome" and "Topps Chrome" (Antropov
#297) stay two separate candidates. A COMC card without an RC flag dated later than the NHL rookie season is ignored, so it can
neither lock a later first year nor outrank SCP candidates; an earlier COMC first year does replace a later SCP one (Bitetto
2015-16 OPC #510 over 2020-21). Each record keeps a `comc` note (player page URL, match quality, finding).

**Pass 2 details (2026-10-19).** Trigger: Ben Maxwell (rookie 2008-09) showed only 2008 OPC #782 although COMC lists OPC Premier, Artifacts, Champ's,
Be A Player, SP Authentic, Ultimate Collection, Ice, The Cup and the OPC parallels for 2008-09. SCP simply has no rows for most of them: its 2008-09
set pages are sparse (2008 Artifacts 15 rows, Ice 14, Champ's 12, Be A Player 3, SPx 13) and there is no 2008 OPC Premier, Ultimate Collection, The Cup or
Power Play set listing for him at all; SCP only lists cards that have sale data, and the 100-row name search only returned the OPC row. Maxwell now has
2008 OPC #782, 2008 OPC Premier #65 and 2008 Artifacts #307 (SP Authentic, Be A Player, Champ's, Ice, Ultimate Collection and The Cup are in COMC but cut by the three-option ladder).
- Pages used: the oldest-100 player page (`/Cards/Hockey,so,vDetails,i100`) plus, only when a player has more than 100 listings and those 100 end inside the first card
  year, the rookie-filter page (same URL with `,_RC`; the `_RC` token restricts the listing to RC-flagged cards, parallels included). Only 4 players needed it.
- Eligibility changed: COMC's `SN` flag is per card and no longer disqualifies a base-set card (Artifacts / SP Authentic / Ice rookies are numbered /999 yet are base-set
  rookies); the set-name suffix (`- [Base]` with no parallel suffix) still excludes parallels, and premium sets are classed by set name at merge time. Oddball sets (Pepsi,
  Vachon, Finnish, Sports Action, ...) and redemption cards are excluded, and COMC-only sets must match a mainstream brand list. The findings now carry all mainstream base cards
  up to rookie season + 3 (the merge applies the first-year rule), and the pass-1 players were re-evaluated offline with the same rules.
- Modern players with no Young Guns: a COMC confirmation can no longer lift the flagship to high (judgement call), so the three options stay visible.
- Merge: COMC "Upper Deck Series 1/2/Extended Series" is the same set as SCP "Upper Deck" (otherwise a duplicate Young Guns candidate appeared).
- **Team-set rule (proposal, not confirmed by the owner)**: a team-issue base set that mirrors the main design (e.g. 1999-00 Topps Toronto Maple Leafs TOR-NA, Antropov) is added as a
  labelled, low-ranked "Team set" option from the first card year, after every main-set option; it never leads, does not affect the first-year rule and is skipped when a
  high option exists. It may be a 4th option on top of the three-option ladder. Currently only Antropov has one.
