#!/usr/bin/env python3
"""Generate a dataset of all players with at least one GP for Winnipeg Jets (WPG)."""

from __future__ import annotations

import json
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

API_BASE = "https://api-web.nhle.com/v1"
TEAM_ABBREVIATION = "WPG"
GAME_TYPE_REGULAR = 2
GAME_TYPE_PLAYOFF = 3
OUTPUT_PATH = Path("data/wpg_players.json")


@dataclass
class PlayerSeason:
    regular_gp: int = 0
    playoff_gp: int = 0


@dataclass
class PlayerRecord:
    player_id: int
    player_name: str
    position: str
    seasons: dict[int, PlayerSeason] = field(default_factory=dict)


def fetch_json(url: str):
    request = urllib.request.Request(url, headers={"User-Agent": "wpgjets-players-dataset/1.0"})
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_team_seasons(team_abbrev: str) -> list[dict]:
    url = f"{API_BASE}/club-stats-season/{team_abbrev}"
    return fetch_json(url)


def fetch_club_stats(team_abbrev: str, season: int, game_type: int) -> dict:
    url = f"{API_BASE}/club-stats/{team_abbrev}/{season}/{game_type}"
    return fetch_json(url)


def normalize_name(player_obj: dict) -> str:
    first = player_obj.get("firstName", {}).get("default", "").strip()
    last = player_obj.get("lastName", {}).get("default", "").strip()
    return f"{first} {last}".strip()


def upsert_player(
    players: dict[int, PlayerRecord],
    player_obj: dict,
    season: int,
    game_type: int,
    position_fallback: str,
) -> None:
    player_id = int(player_obj["playerId"])
    player_name = normalize_name(player_obj)
    position = player_obj.get("positionCode") or position_fallback

    record = players.get(player_id)
    if record is None:
        record = PlayerRecord(
            player_id=player_id,
            player_name=player_name,
            position=position,
        )
        players[player_id] = record
    else:
        if not record.player_name and player_name:
            record.player_name = player_name
        if record.position != "G" and position == "G":
            record.position = "G"

    season_stats = record.seasons.setdefault(season, PlayerSeason())
    games_played = int(player_obj.get("gamesPlayed") or 0)

    if game_type == GAME_TYPE_REGULAR:
        season_stats.regular_gp += games_played
    elif game_type == GAME_TYPE_PLAYOFF:
        season_stats.playoff_gp += games_played


def build_dataset() -> list[dict]:
    seasons_payload = fetch_team_seasons(TEAM_ABBREVIATION)
    players: dict[int, PlayerRecord] = {}

    for season_entry in seasons_payload:
        season = int(season_entry["season"])
        game_types = set(season_entry.get("gameTypes", []))

        for game_type in (GAME_TYPE_REGULAR, GAME_TYPE_PLAYOFF):
            if game_type not in game_types:
                continue

            season_stats_payload = fetch_club_stats(TEAM_ABBREVIATION, season, game_type)

            for skater in season_stats_payload.get("skaters", []):
                upsert_player(players, skater, season, game_type, position_fallback="SKATER")

            for goalie in season_stats_payload.get("goalies", []):
                upsert_player(players, goalie, season, game_type, position_fallback="G")

    results: list[dict] = []
    for player in players.values():
        season_rows = []
        total_regular = 0
        total_playoff = 0

        for season in sorted(player.seasons):
            season_data = player.seasons[season]
            total_regular += season_data.regular_gp
            total_playoff += season_data.playoff_gp
            season_rows.append(
                {
                    "season": season,
                    "gamesPlayedRegularSeason": season_data.regular_gp,
                    "gamesPlayedPlayoffs": season_data.playoff_gp,
                }
            )

        if (total_regular + total_playoff) < 1:
            continue

        results.append(
            {
                "playerId": player.player_id,
                "playerName": player.player_name,
                "position": player.position,
                "seasons": season_rows,
                "gamesPlayedRegularSeason": total_regular,
                "gamesPlayedPlayoffs": total_playoff,
            }
        )

    results.sort(key=lambda row: (row["playerName"], row["playerId"]))
    return results


def main() -> None:
    dataset = build_dataset()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(dataset, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(dataset)} players to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
