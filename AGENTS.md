# AGENTS.md

Guidance for AI coding agents working in this repository. Humans: see the same rules here.

## Goal

A **personal Winnipeg Jets rookie card collection tracker**. The user (sole audience) tracks which
Jets players' rookie cards they own or want. Player data (every player to appear in a Winnipeg Jets
game, NHL and WHA) is supporting context, not the product.

Status: **restarting from scratch.** Requirements, data model and stack are not yet decided. Do not
assume them; discuss with the user before building.

## Legacy reference

The previous implementation lives in `legacy/` (static table site, card editor, NHL API generators,
JSON data). It is **reference material only**: read it for ideas and data, but do not build on it or
edit it unless asked. Notable contents:

- `legacy/data/` – player GP data (NHL API + WHA) and rookie card mappings (`isYG`, `set`, `cardNumber`).
- `legacy/scripts/` – Python generators for the NHL data.
- `legacy/README.md` – description of the old project and its rookie-card selection rules.

## Working agreements

- Discuss plans with the user before implementing large changes.
- Keep this file current as decisions are made (goal, stack, data model, commands).
