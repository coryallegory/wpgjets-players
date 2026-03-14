import { loadPlayers } from './data.js';
import { PlayersTable } from './table.js';
import { bindColumnGroupToggles } from './column-groups.js';

const tableElement = document.querySelector('#players-table');
const ownedFilterElement = document.querySelector('#owned-filter');
const playersTable = new PlayersTable(tableElement);

if (ownedFilterElement) {
  ownedFilterElement.addEventListener('change', () => {
    playersTable.setOwnedFilter(ownedFilterElement.value);
  });
}

playersTable.bindSorting();
bindColumnGroupToggles(tableElement);

loadPlayers()
  .then((players) => {
    playersTable.setPlayers(players);

    if (ownedFilterElement) {
      playersTable.setOwnedFilter(ownedFilterElement.value);
    }
  })
  .catch((error) => {
    playersTable.renderError(error.message);
  });
