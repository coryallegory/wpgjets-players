import { loadPlayers } from './data.js';
import { PlayersTable } from './table.js';
import { bindColumnGroupToggles } from './column-groups.js';

const tableElement = document.querySelector('#players-table');
const playersTable = new PlayersTable(tableElement);

playersTable.bindSorting();
bindColumnGroupToggles(tableElement);

loadPlayers()
  .then((players) => {
    playersTable.setPlayers(players);
  })
  .catch((error) => {
    playersTable.renderError(error.message);
  });
