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

export class PlayersTable {
  constructor(tableElement) {
    this.tableElement = tableElement;
    this.tableBody = tableElement.querySelector('tbody');
    this.sortButtons = tableElement.querySelectorAll('thead button[data-key]');
    this.players = [];
    this.sortState = { key: 'playerName', direction: 'asc' };
    this.ownedFilter = 'all';
  }

  setPlayers(players) {
    this.players = players;
    this.updateSortIndicators();
    this.render();
  }

  setOwnedFilter(filter) {
    const nextFilter = ['all', 'owned', 'unowned'].includes(filter) ? filter : 'all';
    this.ownedFilter = nextFilter;
    this.render();
  }

  filteredAndSortedPlayers() {
    return this.players
      .filter((player) => {
        if (this.ownedFilter === 'owned') {
          return player.rookieCardIsOwned;
        }

        if (this.ownedFilter === 'unowned') {
          return !player.rookieCardIsOwned;
        }

        return true;
      })
      .sort((a, b) => {
        const result = compareValues(a, b, this.sortState.key);
        return this.sortState.direction === 'asc' ? result : -result;
      });
  }

  updateSortIndicators() {
    this.sortButtons.forEach((button) => {
      if (button.dataset.key === this.sortState.key) {
        button.dataset.direction = this.sortState.direction;
      } else {
        button.removeAttribute('data-direction');
      }
    });
  }

  bindSorting() {
    this.sortButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.dataset.key;

        if (this.sortState.key === key) {
          this.sortState.direction = this.sortState.direction === 'asc' ? 'desc' : 'asc';
        } else {
          this.sortState = { key, direction: 'asc' };
        }

        this.updateSortIndicators();
        this.render();
      });
    });
  }

  render() {
    this.tableBody.innerHTML = '';

    this.filteredAndSortedPlayers().forEach((player) => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td class="col-player">${player.playerName}</td>
        <td class="col-stats">${player.position}</td>
        <td class="col-stats">${player.gamesPlayedRegularSeason}</td>
        <td class="col-stats">${player.gamesPlayedPlayoffs}</td>
        <td class="col-stats">${player.firstSeasonLabel}</td>
        <td class="col-stats">${player.totalSeasons}</td>
        <td class="col-card">${player.isYoungGuns ? 'Yes' : 'No'}</td>
        <td class="col-card">${player.rookieCardSet}</td>
        <td class="col-card">${player.rookieCardNumber}</td>
        <td class="col-card">${player.rookieCardIsOwned ? 'Yes' : 'No'}</td>
      `;
      this.tableBody.appendChild(row);
    });
  }

  renderError(message) {
    this.tableBody.innerHTML = `<tr><td class="col-player" colspan="10">${message}</td></tr>`;
  }
}
