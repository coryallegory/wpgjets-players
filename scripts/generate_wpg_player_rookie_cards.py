#!/usr/bin/env python3
"""Populate Winnipeg Jets player rookie card mappings."""

from __future__ import annotations

import json
from pathlib import Path

PLAYERS_PATH = Path("data/wpg_players.json")
ROOKIE_CARDS_PATH = Path("data/wpg_player_rookie_cards.json")


def load_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_existing(existing_rows: list[dict]) -> dict[int, dict]:
    by_player_id: dict[int, dict] = {}
    for row in existing_rows:
        player_id = row.get("playerId")
        if player_id is None:
            continue
        try:
            normalized_id = int(player_id)
        except (TypeError, ValueError):
            continue

        by_player_id[normalized_id] = {
            "playerId": normalized_id,
            "playerName": str(row.get("playerName") or ""),
            "isYG": bool(row.get("isYG", False)),
            "set": str(row.get("set") or ""),
            "cardNumber": str(row.get("cardNumber") or ""),
        }
    return by_player_id


def build_rookie_card_dataset(players: list[dict], existing_rows: list[dict]) -> list[dict]:
    existing_by_player_id = normalize_existing(existing_rows)
    merged_by_player_id: dict[int, dict] = existing_by_player_id.copy()

    for player in players:
        player_id = int(player["playerId"])
        player_name = str(player.get("playerName") or "")
        existing = merged_by_player_id.get(player_id)

        if existing is None:
            merged_by_player_id[player_id] = {
                "playerId": player_id,
                "playerName": player_name,
                "isYG": False,
                "set": "",
                "cardNumber": "",
            }
            continue

        if player_name:
            existing["playerName"] = player_name

    results = list(merged_by_player_id.values())
    results.sort(key=lambda row: (row["playerName"], row["playerId"]))
    return results


def main() -> None:
    players = load_json(PLAYERS_PATH, default=[])
    existing_rookie_cards = load_json(ROOKIE_CARDS_PATH, default=[])

    dataset = build_rookie_card_dataset(players, existing_rookie_cards)

    ROOKIE_CARDS_PATH.parent.mkdir(parents=True, exist_ok=True)
    ROOKIE_CARDS_PATH.write_text(
        json.dumps(dataset, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(dataset)} player rookie card rows to {ROOKIE_CARDS_PATH}")


if __name__ == "__main__":
    main()
