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
  nhl: {
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
  assert.equal(r.nhlSeasonCount, 2);
  assert.equal(r.nhlFirstSeason, '1981-82');
  assert.equal(r.nhlYearsLabel, '1981-82 – 1982-83');
  assert.equal(r.position, 'C');
  assert.equal(r.overall, 1);
  assert.equal(r.amateur, 'Cornwall (QMJHL)');
});

test('toRow passes birthDate through and nulls it when absent', () => {
  assert.equal(toRow(curated({ birthDate: '1960-02-07' })).birthDate, '1960-02-07');
  assert.equal(toRow(curated()).birthDate, null);
});

test('Birth Date column sits after Country and displays ISO dates or the missing marker', () => {
  const ids = COLUMNS.map((c) => c.id);
  assert.equal(ids[ids.indexOf('country') + 1], 'birthDate');
  assert.equal(column('birthDate').label, 'Birth Date');
  assert.equal(display(toRow(curated({ birthDate: '1960-02-07' })).birthDate), '1960-02-07');
  assert.equal(display(toRow(curated()).birthDate), MISSING);
});

test('Birth Date sorts chronologically ascending and descending, missing last', () => {
  const rows = [
    row(1, 'A', { birthDate: '1999-12-31' }),
    row(2, 'B', { birthDate: null }),
    row(3, 'C', { birthDate: '1989-01-19' }),
    row(4, 'D', { birthDate: '2000-01-01' }),
    row(5, 'E', { birthDate: '1989-01-02' }),
  ];
  assert.deepEqual(ids(sortRows(rows, column('birthDate'), 'asc')), [5, 3, 1, 4, 2]);
  assert.deepEqual(ids(sortRows(rows, column('birthDate'), 'desc')), [4, 1, 3, 5, 2]);
});

test('toRow handles drafted-only and undrafted players', () => {
  const drafted = toRow(curated({ rookieSeason: null, nhl: { regularGP: 0, playoffGP: 0, seasons: [] } }));
  assert.equal(drafted.nhlSeasonCount, 0);
  assert.equal(drafted.nhlYearsLabel, null);
  assert.equal(drafted.nhlFirstSeason, null);
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
  const rows = [row(1, 'A', { nhlSeasonCount: null }), row(2, 'B', { nhlSeasonCount: 0 })];
  assert.deepEqual(ids(sortRows(rows, column('nhlSeasons'), 'asc')), [2, 1]);
});

test('ties fall back to name then playerId, and input is not mutated', () => {
  const rows = [row(3, 'Same, A', { round: 1 }), row(2, 'Same, A', { round: 1 }), row(1, 'Other, B', { round: 1 })];
  const copy = [...rows];
  assert.deepEqual(ids(sortRows(rows, column('round'), 'asc')), [1, 2, 3]);
  assert.deepEqual(ids(sortRows(rows, column('round'), 'desc')), [1, 2, 3]);
  assert.deepEqual(rows, copy);
});

test('NHL Years sorts by first season', () => {
  const rows = [row(1, 'A', { nhlFirstSeason: '1990-91' }), row(2, 'B', { nhlFirstSeason: '1981-82' }), row(3, 'C', { nhlFirstSeason: null })];
  assert.deepEqual(ids(sortRows(rows, column('nhlYears'), 'asc')), [2, 1, 3]);
});

test('nextSort toggles direction on the same column and resets on a new one', () => {
  assert.deepEqual(nextSort({ columnId: 'name', direction: 'asc' }, 'name'), { columnId: 'name', direction: 'desc' });
  assert.deepEqual(nextSort({ columnId: 'name', direction: 'desc' }, 'name'), { columnId: 'name', direction: 'asc' });
  assert.deepEqual(nextSort({ columnId: 'name', direction: 'desc' }, 'round'), { columnId: 'round', direction: 'asc' });
});

test('GP toggle: on shows players with games, off shows never-played draft picks', () => {
  const rows = [
    row(1, 'P', { playedEras: ['jets1'], draftedEras: [] }),
    row(2, 'D', { playedEras: [], draftedEras: ['jets1'] }),
    row(3, 'B', { playedEras: ['jets2'], draftedEras: ['jets1'] }),
  ];
  assert.deepEqual(ids(filterRows(rows, { gp: true })), [1, 3]);
  assert.deepEqual(ids(filterRows(rows, { gp: false })), [2]);
});

test('toRow derives played and drafted eras', () => {
  const r = toRow(curated({
    nhl: { regularGP: 90, playoffGP: 0, seasons: [{ season: '1981-82', team: 'WIN', regularGP: 80, playoffGP: 0 }, { season: '2013-14', team: 'WPG', regularGP: 10, playoffGP: 0 }] },
    wha: wha([['1975-76', 5, 0]]),
  }));
  assert.deepEqual(r.playedEras, ['wha', 'jets1', 'jets2']);
  assert.deepEqual(r.draftedEras, ['jets1']);
  assert.deepEqual(toRow(curated({ draft: { year: 2007, team: 'ATL' }, nhl: nothing })).draftedEras, []);
  assert.deepEqual(toRow(curated({ draft: { year: 2012, team: 'WPG' } })).draftedEras, ['jets2']);
});

test('era filters apply to the played era (GP on) or the draft era (GP off)', () => {
  const rows = [
    row(1, 'WhaOnly', { playedEras: ['wha'], draftedEras: [] }),
    row(2, 'One', { playedEras: ['jets1'], draftedEras: ['jets1'] }),
    row(3, 'TwoDraftedOne', { playedEras: ['jets2'], draftedEras: ['jets1'] }),
    row(4, 'DraftOnly2', { playedEras: [], draftedEras: ['jets2'] }),
    row(5, 'DraftOnly1', { playedEras: [], draftedEras: ['jets1'] }),
  ];
  const run = (gp, ...on) =>
    ids(filterRows(rows, { gp, eras: { wha: on.includes('wha'), jets1: on.includes('jets1'), jets2: on.includes('jets2') } }));
  assert.deepEqual(run(true, 'wha', 'jets1', 'jets2'), [1, 2, 3]);
  assert.deepEqual(run(true, 'wha'), [1]);
  assert.deepEqual(run(true, 'jets1'), [2]);
  assert.deepEqual(run(true, 'jets2'), [3]);
  assert.deepEqual(run(false, 'wha', 'jets1', 'jets2'), [4, 5]);
  assert.deepEqual(run(false, 'jets1'), [5]);
  assert.deepEqual(run(false, 'wha'), []);
  assert.deepEqual(run(true), []);
});

test('search matches either name order, ignoring case and accents', () => {
  const rows = [toRow(curated()), toRow(curated({ playerId: 2, firstName: 'Viggo', lastName: 'Björck', name: 'Björck, Viggo' }))];
  const search = (query) => ids(filterRows(rows, { gp: true, query }));
  assert.deepEqual(search('bjorck'), [2]);
  assert.deepEqual(search('BJÖRCK'), [2]);
  assert.deepEqual(search('dale haw'), [1]);
  assert.deepEqual(search('hawerchuk, d'), [1]);
  assert.deepEqual(search(''), [1, 2]);
  assert.deepEqual(search('zzz'), []);
});

test('search does not match birth dates', () => {
  const rows = [toRow(curated({ birthDate: '1960-02-07' }))];
  assert.deepEqual(ids(filterRows(rows, { gp: true, query: '1960' })), []);
  assert.deepEqual(ids(filterRows(rows, { gp: true, query: '02-07' })), []);
});

test('search combines with toggles', () => {
  const rows = [row(1, 'Smith, A', { playedEras: [], draftedEras: ['jets1'] }), row(2, 'Smith, B', { playedEras: ['jets1'] })];
  assert.deepEqual(ids(filterRows(rows, { gp: true, query: 'smith' })), [2]);
  assert.deepEqual(ids(filterRows(rows, { gp: false, query: 'smith' })), [1]);
});

const wha = (seasons) => ({
  regularGP: seasons.reduce((n, x) => n + x[1], 0),
  playoffGP: seasons.reduce((n, x) => n + x[2], 0),
  seasons: seasons.map(([season, regularGP, playoffGP]) => ({ season, regularGP, playoffGP })),
  source: { sites: ['hockey-reference.com'], definitive: false },
});
const nothing = { regularGP: 0, playoffGP: 0, seasons: [] };

test('column order: profile, NHL group, WHA group, then draft', () => {
  assert.deepEqual(
    COLUMNS.map((c) => c.label),
    ['Name', 'Rookie Season', 'Pos', 'Country', 'Birth Date',
      'NHL Seasons', 'NHL Years', 'NHL Reg GP', 'NHL Playoff GP',
      'WHA Seasons', 'WHA Years', 'WHA Reg GP', 'WHA Playoff GP',
      'Draft Year', 'Draft Team', 'Round', 'Pick', 'Amateur Team'],
  );
});

test('toRow: player with a WHA block', () => {
  const r = toRow(curated({ wha: wha([['1973-74', 70, 4], ['1972-73', 60, 2], ['1976-77', 10, 0]]) }));
  assert.equal(r.whaSeasonCount, 3);
  assert.equal(r.whaFirstSeason, '1972-73');
  assert.equal(r.whaYearsLabel, '1972-73 – 1976-77');
  assert.equal(r.whaRegularGP, 140);
  assert.equal(r.whaPlayoffGP, 6);
  assert.equal(r.nhlRegularGP, 713);
});

test('toRow: no WHA block gives null (missing marker), never zero', () => {
  const r = toRow(curated());
  for (const k of ['whaSeasonCount', 'whaFirstSeason', 'whaYearsLabel', 'whaRegularGP', 'whaPlayoffGP']) {
    assert.equal(r[k], null, k);
    assert.equal(display(r[k]), MISSING);
  }
});

test('toRow: WHA-only player shows 0 NHL values and WHA values', () => {
  const r = toRow(curated({ nhl: nothing, rookieSeason: null, draft: null, wha: wha([['1972-73', 71, 12]]) }));
  assert.equal(r.nhlSeasonCount, 0);
  assert.equal(r.nhlRegularGP, 0);
  assert.equal(r.nhlPlayoffGP, 0);
  assert.equal(r.nhlYearsLabel, null);
  assert.equal(r.whaYearsLabel, '1972-73');
  assert.equal(r.whaRegularGP, 71);
});

test('toRow: a missing nhl block is treated as zeros and does not throw', () => {
  const { nhl, ...noNhl } = curated();
  const r = toRow(noNhl);
  assert.equal(r.nhlSeasonCount, 0);
  assert.equal(r.nhlRegularGP, 0);
  assert.equal(r.nhlYearsLabel, null);
});

test('toRow: needsReview becomes a flag with notes or a generic title', () => {
  const withNotes = toRow(curated({ needsReview: ['birthDate'], notes: ['HR says 1947', 'hockeydb says 1949'] }));
  assert.equal(withNotes.flags.birthDate, 'Needs review: HR says 1947 hockeydb says 1949');
  const generic = toRow(curated({ needsReview: ['birthDate'] }));
  assert.match(generic.flags.birthDate, /^Needs review: \S/);
  assert.deepEqual(toRow(curated()).flags, {});
  assert.ok(COLUMNS.some((c) => c.field === 'birthDate'));
});

test('WHA columns sort by value with nulls last in both directions', () => {
  const rows = [
    row(1, 'A', { whaRegularGP: null, whaFirstSeason: null, whaSeasonCount: null }),
    row(2, 'B', { whaRegularGP: 300, whaFirstSeason: '1974-75', whaSeasonCount: 2 }),
    row(3, 'C', { whaRegularGP: 20, whaFirstSeason: '1972-73', whaSeasonCount: 1 }),
  ];
  assert.deepEqual(ids(sortRows(rows, column('whaRegularGP'), 'asc')), [3, 2, 1]);
  assert.deepEqual(ids(sortRows(rows, column('whaRegularGP'), 'desc')), [2, 3, 1]);
  assert.deepEqual(ids(sortRows(rows, column('whaYears'), 'asc')), [3, 2, 1]);
  assert.deepEqual(ids(sortRows(rows, column('whaYears'), 'desc')), [2, 3, 1]);
  assert.deepEqual(ids(sortRows(rows, column('whaSeasons'), 'desc')), [2, 3, 1]);
});

test('WHA-only players pass the GP filter', () => {
  const rows = [toRow(curated({ nhl: nothing, draft: null, qualifiedBy: ['played'], wha: wha([['1972-73', 1, 0]]) }))];
  assert.deepEqual(ids(filterRows(rows, { gp: true })), [1]);
  assert.deepEqual(ids(filterRows(rows, { gp: false })), []);
});
