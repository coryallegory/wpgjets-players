function formatSeasonLabel(season) {
  const startYear = Math.floor(season / 10000);
  const endYear = startYear + 1;
  return `${startYear}-${String(endYear).slice(-2)}`;
}

function findFirstSeason(seasons) {
  return seasons.reduce(
    (earliestSeason, currentSeason) =>
      currentSeason.season < earliestSeason ? currentSeason.season : earliestSeason,
    seasons[0].season,
  );
}

function mergeSeasons(seasons) {
  const seasonsByYear = new Map();

  seasons.forEach((season) => {
    const existingSeason = seasonsByYear.get(season.season);

    if (existingSeason) {
      existingSeason.gamesPlayedRegularSeason += season.gamesPlayedRegularSeason;
      existingSeason.gamesPlayedPlayoffs += season.gamesPlayedPlayoffs;
      return;
    }

    seasonsByYear.set(season.season, {
      season: season.season,
      gamesPlayedRegularSeason: season.gamesPlayedRegularSeason,
      gamesPlayedPlayoffs: season.gamesPlayedPlayoffs,
    });
  });

  return [...seasonsByYear.values()].sort((a, b) => a.season - b.season);
}

function mergePlayersById(players) {
  const playersById = new Map();

  players.forEach((player) => {
    const existingPlayer = playersById.get(player.playerId);

    if (!existingPlayer) {
      playersById.set(player.playerId, {
        ...player,
        seasons: player.seasons.map((season) => ({ ...season })),
      });
      return;
    }

    existingPlayer.playerName = existingPlayer.playerName || player.playerName;
    existingPlayer.position = existingPlayer.position || player.position;
    existingPlayer.seasons.push(...player.seasons);
  });

  return [...playersById.values()].map((player) => {
    const mergedSeasons = mergeSeasons(player.seasons);

    return {
      ...player,
      seasons: mergedSeasons,
      gamesPlayedRegularSeason: mergedSeasons.reduce(
        (total, season) => total + season.gamesPlayedRegularSeason,
        0,
      ),
      gamesPlayedPlayoffs: mergedSeasons.reduce(
        (total, season) => total + season.gamesPlayedPlayoffs,
        0,
      ),
    };
  });
}

export async function loadPlayers() {
  const [playersResponse, rookieCardsResponse] = await Promise.all([
    fetch('data/wpg_players.json'),
    fetch('data/wpg_player_rookie_cards.json'),
  ]);

  if (!playersResponse.ok) {
    throw new Error(`Failed to load player data: ${playersResponse.status}`);
  }


  if (!rookieCardsResponse.ok) {
    throw new Error(`Failed to load rookie card data: ${rookieCardsResponse.status}`);
  }


  const [playersData, rookieCardsData] = await Promise.all([
    playersResponse.json(),
    rookieCardsResponse.json(),
  ]);

  const rookieCardsByPlayerId = new Map(rookieCardsData.map((card) => [card.playerId, card]));

  return playersData.map((player) => {
    const firstSeason = findFirstSeason(player.seasons);
    const rookieCard = rookieCardsByPlayerId.get(player.playerId);

    return {
      ...player,
      firstSeason,
      firstSeasonLabel: formatSeasonLabel(firstSeason),
      totalSeasons: player.seasons.length,
      isYoungGuns: rookieCard?.isYG ?? false,
      rookieCardSet: rookieCard?.set ?? '',
      rookieCardNumber: rookieCard?.cardNumber ?? '',
    };
  });
}
