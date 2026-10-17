# Winnipeg Jets Rookie Card Tracker

A personal tracker for the rookie cards of every player tied to a Winnipeg Jets franchise: the WHA
Jets, Jets 1.0 and Jets 2.0. A player qualifies by playing at least one regular-season or playoff
game for one of them, or (NHL era) by being drafted by one.

It is a static website with no build step. Data is prepared offline by scripts, committed to git, and
published as-is with GitHub Pages.

## Project status

Phased plan, with status in [AGENTS.md](AGENTS.md) and details in [docs/](docs/):

1. Player list (names, birth dates, seasons, positions, draft info), built from NHL data plus
   WHA sources. Done.
2. The target rookie card for each player.
3. Whether the card is collected.
4. Market price.

## Layout

| Path | Contents |
|---|---|
| `site/` | The published website and its data (`site/data/curated/`). Only this folder is deployed. |
| `scripts/` | Node.js scripts that pull, reconcile and merge data. One script per source; the finished WHA pipeline is in `scripts/wha/`. |
| `docs/` | Data model, pipeline and card-selection rules. |
| `data/decisions/` | Hand-made decisions that scripts honour (reviewed matches, overrides, name variants). |
| `tests/` | Tests, run with Node's built-in test runner. |
| `temp/` | Raw pulled data and caches. Not committed, safe to delete and rebuild. |
| `legacy/` | The previous implementation. Reference only. |

## Using it

Requires Node.js 22 or newer. There are no dependencies to install.

```
npm run serve      # preview the site at http://localhost:8000
npm test           # run the tests
npm run validate   # check the data files
npm run setup:hooks  # once per clone: validate data before commits
```

The data scripts (`get:*`, `reconcile:wha`, `merge:wha`, `sync:nhl`) are described, with their
order and rules, in [docs/pipeline.md](docs/pipeline.md). Keeping the NHL data current is `npm run get:nhl`
followed by `npm run sync:nhl`.

## Data sources

NHL official data (nhl.com) is treated as definitive. WHA data comes from Hockey-Reference and
hockeydb, cross-checked against Wikipedia and card references, and is marked as non-definitive in the
data. Each record says where it came from.

## For AI assistants

Read [AGENTS.md](AGENTS.md) first. It holds the goals, decisions and conventions.
