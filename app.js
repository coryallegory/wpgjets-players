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
      <td>${player.totalSeasons}</td>
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

async function loadPlayers() {
  const response = await fetch('data/wpg_players.json');

  if (!response.ok) {
    throw new Error(`Failed to load player data: ${response.status}`);
  }

  const data = await response.json();
  players = data.map((player) => ({
    ...player,
    totalSeasons: player.seasons.length,
  }));

  updateSortIndicators();
  renderTable();
}

loadPlayers().catch((error) => {
  tableBody.innerHTML = `<tr><td colspan="5">${error.message}</td></tr>`;
});
