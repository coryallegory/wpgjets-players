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

async function loadPlayers() {
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

  const rookieCardsByPlayerId = new Map(
    rookieCardsData.map((card) => [card.playerId, card]),
  );

  players = playersData.map((player) => {
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
