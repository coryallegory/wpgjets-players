import { COLUMNS, DEFAULT_SORT, parseHidden, visibleColumns } from './lib/columns.js';
import { filterRows } from './lib/filter.js';
import { toRow } from './lib/format.js';
import { nextSort, sortRows } from './lib/sort.js';
import { createHeader, renderMessage, renderRows } from './table.js';

const DATA_URL = 'data/curated/players.json';
const CARDS_URL = 'data/curated/cards.json';
const HIDDEN_KEY = 'wpgjets.hiddenColumns';

// Browser storage can be unavailable or throw (private windows, blocked site data).
const loadHidden = () => {
  try {
    return parseHidden(localStorage.getItem(HIDDEN_KEY), COLUMNS);
  } catch {
    return new Set();
  }
};
const saveHidden = (hidden) => {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
  } catch {
    // not persisted; the choice still applies for this visit
  }
};

const $ = (id) => document.getElementById(id);
const tbody = $('rows');
const countEl = $('count');
const searchInput = $('search');
const gpToggle = $('filter-gp');
const eraToggles = { wha: $('filter-wha'), jets1: $('filter-jets1'), jets2: $('filter-jets2') };

const state = {
  rows: [],
  sort: { ...DEFAULT_SORT },
  gp: true,
  eras: { wha: true, jets1: true, jets2: true },
  query: '',
  hidden: loadHidden(),
};

const updateHeader = createHeader($('head'), (columnId) => {
  state.sort = nextSort(state.sort, columnId);
  render();
});

function render() {
  const columns = visibleColumns(COLUMNS, state.hidden);
  updateHeader(columns, state.sort);
  const column = COLUMNS.find((c) => c.id === state.sort.columnId);
  const visible = sortRows(filterRows(state.rows, state), column, state.sort.direction);
  countEl.textContent = `Showing ${visible.length} of ${state.rows.length}`;
  if (visible.length === 0) {
    const noEras = !Object.values(state.eras).some(Boolean);
    const text = noEras
      ? 'No eras are active. Turn on Jets WHA, Jets 1.0 or Jets 2.0 to see players.'
      : 'No players match.';
    renderMessage(tbody, text, 'empty', columns.length);
  } else {
    renderRows(tbody, visible, columns);
  }
}

gpToggle.setAttribute('aria-pressed', String(state.gp));
gpToggle.addEventListener('click', () => {
  state.gp = !state.gp;
  gpToggle.setAttribute('aria-pressed', String(state.gp));
  render();
});

for (const [id, button] of Object.entries(eraToggles)) {
  button.setAttribute('aria-pressed', String(state.eras[id]));
  button.addEventListener('click', () => {
    state.eras[id] = !state.eras[id];
    button.setAttribute('aria-pressed', String(state.eras[id]));
    render();
  });
}

const columnsList = $('columns-list');
const columnBoxes = new Map();
for (const column of COLUMNS.filter((c) => !c.locked)) {
  const label = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = !state.hidden.has(column.id);
  box.addEventListener('change', () => {
    if (box.checked) state.hidden.delete(column.id);
    else state.hidden.add(column.id);
    // Sorting by a column that is no longer shown would be confusing.
    if (state.hidden.has(state.sort.columnId)) state.sort = { ...DEFAULT_SORT };
    saveHidden(state.hidden);
    render();
  });
  label.append(box, column.label);
  columnsList.append(label);
  columnBoxes.set(column.id, box);
}
$('columns-reset').addEventListener('click', () => {
  state.hidden.clear();
  for (const box of columnBoxes.values()) box.checked = true;
  saveHidden(state.hidden);
  render();
});

searchInput.addEventListener('input', () => {
  state.query = searchInput.value;
  render();
});

async function load() {
  updateHeader(visibleColumns(COLUMNS, state.hidden), state.sort);
  renderMessage(tbody, 'Loading players…', 'empty', visibleColumns(COLUMNS, state.hidden).length);
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const players = await response.json();
    // Cards are optional: without them every Rookie Card cell is simply blank.
    let cards = {};
    try {
      const cardsResponse = await fetch(CARDS_URL);
      if (cardsResponse.ok) cards = await cardsResponse.json();
    } catch {
      // keep the table usable without card data
    }
    state.rows = players.map((p) => toRow(p, cards[p.playerId] ?? null));
    render();
  } catch (error) {
    countEl.textContent = '';
    renderMessage(tbody, `Could not load players (${error.message}).`, 'error', visibleColumns(COLUMNS, state.hidden).length);
  }
}

load();
