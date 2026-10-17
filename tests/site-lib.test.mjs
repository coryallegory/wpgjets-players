import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLUMNS } from '../site/js/lib/columns.js';
import { filterRows } from '../site/js/lib/filter.js';
import { MISSING, display, toRow, yearsLabel } from '../site/js/lib/format.js';
import { nextSort, sortRows } from '../site/js/lib/sort.js';
import { normalizeText } from '../site/js/lib/text.js';

const column = (id) => COLUMNS.find((c) => c.id === id);
const ids = (rows) => rows.map((r) => r.playerId);

const curated = (overrides = {}) => ({
  playerId: 1,
  firstName: 'Dale',
  lastName: 'Hawerchuk',
  name: 'Hawerchuk, Dale',
  country: 'CAN',
  positions: ['C'],
  rookieSeason: '1981-82',
  jets: {
    regularGP: 713,
    playoffGP: 33,
    seasons: [
      { season: '1982-83', team: 'WIN', regularGP: 79, playoffGP: 3 },
      { season: '1981-82', team: 'WIN', regularGP: 80, playoffGP: 4 },
    ],
  },
  draft: { year: 1981, team: 'WIN', round: 1, overall: 1, amateur: 'Cornwall (QMJHL)' },
  qualifiedBy: ['played', 'drafted'],
  ...overrides,
});

const row = (playerId, name, extra = {}) => ({ playerId, name, qualifiedBy: ['played'], ...extra });

test('normalizeText strips accents and case', () => {
  assert.equal(normalizeText('  Björck, Viggo '), 'bjorck, viggo');
  assert.equal(normalizeText(null), '');
});

test('display and yearsLabel', () => {
  assert.equal(display(null), MISSING);
  assert.equal(display(undefined), MISSING);
  assert.equal(display(0), '0');
  assert.equal(yearsLabel('1981-82', '1989-90'), '1981-82 – 1989-90');
  assert.equal(yearsLabel('1981-82', '1981-82'), '1981-82');
  assert.equal(yearsLabel(null, null), null);
});

test('toRow builds the view model', () => {
  const r = toRow(curated());
  assert.equal(r.name, 'Hawerchuk, Dale');
  assert.equal(r.seasonCount, 2);
  assert.equal(r.firstSeason, '1981-82');
  assert.equal(r.yearsLabel, '1981-82 – 1982-83');
  assert.equal(r.position, 'C');
  assert.equal(r.overall, 1);
  assert.equal(r.amateur, 'Cornwall (QMJHL)');
});

test('toRow handles drafted-only and undrafted players', () => {
  const drafted = toRow(curated({ rookieSeason: null, jets: { regularGP: 0, playoffGP: 0, seasons: [] } }));
  assert.equal(drafted.seasonCount, 0);
  assert.equal(drafted.yearsLabel, null);
  assert.equal(drafted.firstSeason, null);
  const undrafted = toRow(curated({ draft: null }));
  assert.equal(undrafted.draftYear, null);
  assert.equal(undrafted.overall, null);
});

test('name sort is accent- and case-insensitive on last name', () => {
  const rows = [
    row(1, 'Zubov, Sergei'),
    row(2, 'bjorck, Anna'),
    row(3, 'Björck, Viggo'),
    row(4, 'Albert, John'),
    row(5, 'Akerblom, Markus'),
  ];
  assert.deepEqual(ids(sortRows(rows, column('name'), 'asc')), [5, 4, 2, 3, 1]);
  assert.deepEqual(ids(sortRows(rows, column('name'), 'desc')), [1, 3, 2, 4, 5]);
});

test('numeric sort is numeric, not lexical', () => {
  const rows = [row(1, 'A', { overall: 100 }), row(2, 'B', { overall: 9 }), row(3, 'C', { overall: 20 })];
  assert.deepEqual(ids(sortRows(rows, column('overall'), 'asc')), [2, 3, 1]);
  assert.deepEqual(ids(sortRows(rows, column('overall'), 'desc')), [1, 3, 2]);
});

test('missing values sort last in both directions', () => {
  const rows = [row(1, 'A', { overall: null }), row(2, 'B', { overall: 5 }), row(3, 'C', { overall: 1 })];
  assert.deepEqual(ids(sortRows(rows, column('overall'), 'asc')), [3, 2, 1]);
  assert.deepEqual(ids(sortRows(rows, column('overall'), 'desc')), [2, 3, 1]);
  const text = [row(1, 'A', { country: null }), row(2, 'B', { country: 'USA' })];
  assert.deepEqual(ids(sortRows(text, column('country'), 'desc')), [2, 1]);
});

test('zero is a value, not missing', () => {
  const rows = [row(1, 'A', { seasonCount: null }), row(2, 'B', { seasonCount: 0 })];
  assert.deepEqual(ids(sortRows(rows, column('seasonCount'), 'asc')), [2, 1]);
});

test('ties fall back to name then playerId, and input is not mutated', () => {
  const rows = [row(3, 'Same, A', { round: 1 }), row(2, 'Same, A', { round: 1 }), row(1, 'Other, B', { round: 1 })];
  const copy = [...rows];
  assert.deepEqual(ids(sortRows(rows, column('round'), 'asc')), [1, 2, 3]);
  assert.deepEqual(ids(sortRows(rows, column('round'), 'desc')), [1, 2, 3]);
  assert.deepEqual(rows, copy);
});

test('Jets Years sorts by first season', () => {
  const rows = [row(1, 'A', { firstSeason: '1990-91' }), row(2, 'B', { firstSeason: '1981-82' }), row(3, 'C', { firstSeason: null })];
  assert.deepEqual(ids(sortRows(rows, column('years'), 'asc')), [2, 1, 3]);
});

test('nextSort toggles direction on the same column and resets on a new one', () => {
  assert.deepEqual(nextSort({ columnId: 'name', direction: 'asc' }, 'name'), { columnId: 'name', direction: 'desc' });
  assert.deepEqual(nextSort({ columnId: 'name', direction: 'desc' }, 'name'), { columnId: 'name', direction: 'asc' });
  assert.deepEqual(nextSort({ columnId: 'name', direction: 'desc' }, 'round'), { columnId: 'round', direction: 'asc' });
});

test('filter toggles: played / drafted combinations', () => {
  const rows = [
    row(1, 'P', { qualifiedBy: ['played'] }),
    row(2, 'D', { qualifiedBy: ['drafted'] }),
    row(3, 'B', { qualifiedBy: ['played', 'drafted'] }),
  ];
  const run = (played, drafted) => ids(filterRows(rows, { played, drafted }));
  assert.deepEqual(run(true, true), [1, 2, 3]);
  assert.deepEqual(run(true, false), [1, 3]);
  assert.deepEqual(run(false, true), [2, 3]);
  assert.deepEqual(run(false, false), []);
});

test('search matches either name order, ignoring case and accents', () => {
  const rows = [toRow(curated()), toRow(curated({ playerId: 2, firstName: 'Viggo', lastName: 'Björck', name: 'Björck, Viggo' }))];
  const search = (query) => ids(filterRows(rows, { played: true, drafted: true, query }));
  assert.deepEqual(search('bjorck'), [2]);
  assert.deepEqual(search('BJÖRCK'), [2]);
  assert.deepEqual(search('dale haw'), [1]);
  assert.deepEqual(search('hawerchuk, d'), [1]);
  assert.deepEqual(search(''), [1, 2]);
  assert.deepEqual(search('zzz'), []);
});

test('search combines with toggles', () => {
  const rows = [row(1, 'Smith, A', { qualifiedBy: ['drafted'] }), row(2, 'Smith, B', { qualifiedBy: ['played'] })];
  assert.deepEqual(ids(filterRows(rows, { played: true, drafted: false, query: 'smith' })), [2]);
});
