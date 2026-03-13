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

  const rookieCardsByPlayerId = new Map();

  rookieCardsData.forEach((card) => {
    if (!rookieCardsByPlayerId.has(card.playerId)) {
      rookieCardsByPlayerId.set(card.playerId, card);
    }
  });

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
