const tableBody = document.querySelector('#players-table tbody');
const sortButtons = document.querySelectorAll('#players-table thead button');

let players = [];
let sortState = { key: 'playerName', direction: 'asc' };

function compareValues(a, b, key) {
  const aValue = a[key];
  const bValue = b[key];

  if (typeof aValue === 'number' && typeof bValue === 'number') {
    return aValue - bValue;
  }

  if (typeof aValue === 'boolean' && typeof bValue === 'boolean') {
    return Number(aValue) - Number(bValue);
  }

  return String(aValue).localeCompare(String(bValue));
}

function sortedPlayers() {
  return [...players].sort((a, b) => {
    const result = compareValues(a, b, sortState.key);
    return sortState.direction === 'asc' ? result : -result;
  });
}

function renderTable() {
  tableBody.innerHTML = '';

  sortedPlayers().forEach((player) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${player.playerName}</td>
      <td>${player.position}</td>
      <td>${player.gamesPlayedRegularSeason}</td>
      <td>${player.gamesPlayedPlayoffs}</td>
      <td>${player.firstSeasonLabel}</td>
      <td>${player.totalSeasons}</td>
      <td>${player.isYoungGuns ? 'Yes' : 'No'}</td>
      <td>${player.rookieCardSet}</td>
      <td>${player.rookieCardNumber}</td>
    `;
    tableBody.appendChild(row);
  });
}

function updateSortIndicators() {
  sortButtons.forEach((button) => {
    if (button.dataset.key === sortState.key) {
      button.dataset.direction = sortState.direction;
    } else {
      button.removeAttribute('data-direction');
    }
  });
}

sortButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const key = button.dataset.key;

    if (sortState.key === key) {
      sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
    } else {
      sortState = { key, direction: 'asc' };
    }

    updateSortIndicators();
    renderTable();
  });
});

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

function mergePlayersById(playersList) {
  const playersById = new Map();

  playersList.forEach((player) => {
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

async function loadPlayers() {
  const [playersResponse, whaPlayersResponse, rookieCardsResponse, whaRookieCardsResponse] =
    await Promise.all([
      fetch('data/wpg_players.json'),
      fetch('data/wha_winnipeg_jets_players.json'),
      fetch('data/wpg_player_rookie_cards.json'),
      fetch('data/wha_winnipeg_jets_player_rookie_cards.json'),
    ]);

  if (!playersResponse.ok) {
    throw new Error(`Failed to load player data: ${playersResponse.status}`);
  }

  if (!whaPlayersResponse.ok) {
    throw new Error(`Failed to load WHA player data: ${whaPlayersResponse.status}`);
  }

  if (!rookieCardsResponse.ok) {
    throw new Error(`Failed to load rookie card data: ${rookieCardsResponse.status}`);
  }

  if (!whaRookieCardsResponse.ok) {
    throw new Error(`Failed to load WHA rookie card data: ${whaRookieCardsResponse.status}`);
  }

  const [playersData, whaPlayersData, rookieCardsData, whaRookieCardsData] = await Promise.all([
    playersResponse.json(),
    whaPlayersResponse.json(),
    rookieCardsResponse.json(),
    whaRookieCardsResponse.json(),
  ]);

  const mergedPlayers = mergePlayersById([...playersData, ...whaPlayersData]);
  const mergedRookieCards = [...rookieCardsData, ...whaRookieCardsData];

  const rookieCardsByPlayerId = new Map(
    mergedRookieCards.map((card) => [card.playerId, card]),
  );

  players = mergedPlayers.map((player) => {
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

  updateSortIndicators();
  renderTable();
}

loadPlayers().catch((error) => {
  tableBody.innerHTML = `<tr><td colspan="9">${error.message}</td></tr>`;
});
