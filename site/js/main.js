import { COLUMNS, DEFAULT_SORT } from './lib/columns.js';
import { filterRows } from './lib/filter.js';
import { toRow } from './lib/format.js';
import { nextSort, sortRows } from './lib/sort.js';
import { createHeader, renderMessage, renderRows } from './table.js';

const DATA_URL = 'data/curated/players.json';

const $ = (id) => document.getElementById(id);
const tbody = $('rows');
const countEl = $('count');
const searchInput = $('search');
const toggles = { played: $('filter-played'), drafted: $('filter-drafted') };

const state = { rows: [], sort: { ...DEFAULT_SORT }, played: true, drafted: true, query: '' };

const updateHeader = createHeader($('head'), (columnId) => {
  state.sort = nextSort(state.sort, columnId);
  render();
});

function render() {
  updateHeader(state.sort);
  const column = COLUMNS.find((c) => c.id === state.sort.columnId);
  const visible = sortRows(filterRows(state.rows, state), column, state.sort.direction);
  countEl.textContent = `Showing ${visible.length} of ${state.rows.length}`;
  if (visible.length === 0) {
    const noFilters = !state.played && !state.drafted;
    const text = noFilters ? 'No filters are active. Turn on Played or Drafted to see players.' : 'No players match.';
    renderMessage(tbody, text, 'empty');
  } else {
    renderRows(tbody, visible);
  }
}

for (const key of ['played', 'drafted']) {
  const button = toggles[key];
  button.setAttribute('aria-pressed', String(state[key]));
  button.addEventListener('click', () => {
    state[key] = !state[key];
    button.setAttribute('aria-pressed', String(state[key]));
    render();
  });
}

searchInput.addEventListener('input', () => {
  state.query = searchInput.value;
  render();
});

async function load() {
  updateHeader(state.sort);
  renderMessage(tbody, 'Loading players…', 'empty');
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.rows = (await response.json()).map(toRow);
    render();
  } catch (error) {
    countEl.textContent = '';
    renderMessage(tbody, `Could not load players (${error.message}).`, 'error');
  }
}

load();
