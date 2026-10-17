import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlayers, sortableName, validateIdMap } from '../scripts/validate.mjs';

const player = (overrides = {}) => ({
  playerId: 1,
  firstName: 'Test',
  lastName: 'Player',
  name: 'Player, Test',
  country: 'CAN',
  birthDate: '1970-01-01',
  positions: ['C'],
  rookieSeason: '1990-91',
  nhl: {
    regularGP: 100,
    playoffGP: 3,
    seasons: [
      { season: '1990-91', team: 'WIN', regularGP: 60, playoffGP: 0 },
      { season: '1991-92', team: 'WIN', regularGP: 40, playoffGP: 3 },
    ],
  },
  draft: { year: 1989, team: 'WIN', round: 2, overall: 30, amateur: 'Barrie (OHL)' },
  qualifiedBy: ['played', 'drafted'],
  source: { site: 'nhl.com', definitive: true, retrieved: '2026-10-16' },
  ...overrides,
});

const draftedOnly = (overrides = {}) =>
  player({ rookieSeason: null, nhl: { regularGP: 0, playoffGP: 0, seasons: [] }, qualifiedBy: ['drafted'], ...overrides });

const errorsFor = (overrides) => validatePlayers([player(overrides)]);
const expectOne = (errors, pattern) => {
  assert.equal(errors.length, 1, errors.join('\n'));
  assert.match(errors[0], pattern);
};

test('valid players produce no errors', () => {
  const noDraft = player({ playerId: 3, birthDate: null, draft: null, qualifiedBy: ['played'], rookieSeason: '1988-89' });
  assert.deepEqual(validatePlayers([player(), draftedOnly({ playerId: 2, birthDate: '1971-02-02' }), noDraft]), []);
});

test('non-array input is reported', () => {
  assert.deepEqual(validatePlayers({}), ['players must be an array']);
});

test('duplicate and non-numeric playerId are reported', () => {
  expectOne(validatePlayers([player(), player({ birthDate: '1971-01-01' })]), /duplicate playerId 1/);
  expectOne(errorsFor({ playerId: '1' }), /playerId must be a number/);
});

test('names: firstName/lastName strings and derived name', () => {
  assert.equal(sortableName('Dale', 'Hawerchuk'), 'Hawerchuk, Dale');
  assert.equal(sortableName('', 'Selanne'), 'Selanne');
  assert.deepEqual(errorsFor({ firstName: '', name: 'Player' }), []);
  assert.match(errorsFor({ lastName: '', name: ', Test' }).join(' '), /lastName must be a non-empty string/);
  expectOne(errorsFor({ firstName: undefined }), /firstName must be a string/);
  expectOne(errorsFor({ name: 'Test Player' }), /name "Test Player" must equal "Player, Test"/);
});

test('empty name and bad positions are reported', () => {
  expectOne(errorsFor({ name: '  ' }), /name must be a non-empty string/);
  expectOne(errorsFor({ positions: 'C' }), /positions must be an array/);
  expectOne(errorsFor({ positions: ['C', ''] }), /positions must be an array/);
});

test('rookieSeason must be null or a valid consecutive season', () => {
  assert.deepEqual(validatePlayers([draftedOnly({ rookieSeason: null })]), []);
  assert.deepEqual(validatePlayers([draftedOnly({ rookieSeason: '1992-93' })]), []); // NHL career elsewhere
  expectOne(errorsFor({ rookieSeason: '1990-95' }), /invalid rookieSeason/);
  expectOne(errorsFor({ rookieSeason: '1990/91' }), /invalid rookieSeason/);
  expectOne(errorsFor({ rookieSeason: undefined }), /invalid rookieSeason/);
});

test('rookieSeason (first NHL or WHA regular season) is required with Jets GP and not after the first Jets regular season', () => {
  expectOne(errorsFor({ rookieSeason: null }), /rookieSeason must not be null/);
  expectOne(validatePlayers([whaOnly({ rookieSeason: null })]), /rookieSeason must not be null/);
  assert.deepEqual(errorsFor({ rookieSeason: '1985-86' }), []); // earlier career elsewhere is fine
  expectOne(errorsFor({ rookieSeason: '1991-92' }), /rookieSeason 1991-92 is later than the first Jets regular season 1990-91/);
  // WHA Jets seasons count too
  expectOne(errorsFor({ rookieSeason: '1990-91', wha: whaBlock() }), /later than the first Jets regular season 1975-76/);
  // playoff-only seasons do not bound the (regular-season) rookie season
  const playoffOnly = whaBlock({ regularGP: 0, playoffGP: 2, seasons: [{ season: '1978-79', regularGP: 0, playoffGP: 2 }] });
  assert.deepEqual(validatePlayers([whaOnly({ wha: playoffOnly, rookieSeason: '1979-80' })]), []);
});

test('nhl season rows are checked', () => {
  const row = { season: '1990-91', team: 'WIN', regularGP: 100, playoffGP: 3 };
  const nhl = (...r) => ({ regularGP: r.reduce((t, x) => t + (x.regularGP > 0 ? x.regularGP : 0), 0), playoffGP: 3, seasons: r });
  expectOne(errorsFor({ nhl: nhl({ ...row, season: '1990-95' }) }), /invalid season "1990-95"/);
  expectOne(errorsFor({ nhl: nhl({ ...row, team: 'ATL' }) }), /nhl: invalid team "ATL"/);
  expectOne(errorsFor({ nhl: nhl({ ...row, regularGP: -1 }) }), /regularGP must be a non-negative integer/);
  expectOne(errorsFor({ nhl: nhl({ ...row, playoffGP: 1.5 }) }), /playoffGP must be a non-negative integer/);
  expectOne(errorsFor({ qualifiedBy: ['drafted'], nhl: { regularGP: 0, playoffGP: 0, seasons: 'x' } }), /seasons must be an array/);
  const dup = { regularGP: 100, playoffGP: 3, seasons: [{ ...row, regularGP: 50, playoffGP: 0 }, { ...row, regularGP: 50 }] };
  expectOne(errorsFor({ nhl: dup }), /nhl: duplicate season row 1990-91 WIN/);
});

test('nhl totals must equal season sums', () => {
  const base = player().nhl;
  expectOne(errorsFor({ nhl: { ...base, regularGP: 99 } }), /nhl.regularGP 99 does not equal season sum 100/);
  expectOne(errorsFor({ nhl: { ...base, playoffGP: 4 } }), /nhl.playoffGP 4 does not equal season sum 3/);
});

test('schema v1 jets block is rejected; nhl is required', () => {
  const { nhl, ...v1 } = player();
  const errors = validatePlayers([{ ...v1, jets: nhl }]);
  assert.ok(errors.some((e) => /jets was renamed to nhl/.test(e)), errors.join('\n'));
  assert.ok(errors.some((e) => /nhl must be an object/.test(e)), errors.join('\n'));
});

test('draft must be null or a complete record', () => {
  assert.deepEqual(errorsFor({ draft: { year: 1989, team: 'ATL', round: 1, overall: 5, amateur: null }, qualifiedBy: ['played'] }), []);
  expectOne(errorsFor({ draft: 'x' }), /draft must be null or an object/);
  expectOne(errorsFor({ draft: { year: 1989, team: 'WIN', round: 2, overall: 0, amateur: null } }), /draft.overall/);
  expectOne(errorsFor({ draft: { year: 1989, team: '', round: 2, overall: 3, amateur: null } }), /draft.team/);
  expectOne(errorsFor({ draft: { year: 1989, team: 'WIN', round: 2, overall: 3 } }), /draft.amateur/);
});

test('qualifiedBy rules are enforced', () => {
  expectOne(errorsFor({ qualifiedBy: [] }), /qualifiedBy must be a non-empty array/);
  expectOne(errorsFor({ qualifiedBy: ['played', 'signed'] }), /qualifiedBy must be a non-empty array/);
  expectOne(errorsFor({ qualifiedBy: ['drafted'] }), /Jets GP .*but qualifiedBy lacks "played"/);
  expectOne(validatePlayers([draftedOnly({ qualifiedBy: ['played', 'drafted'] })]), /"played" but Jets GP .*is 0/);
  expectOne(validatePlayers([draftedOnly({ draft: null })]), /"drafted" but draft is null/);
});

test('source requires site and boolean definitive', () => {
  const { source, ...withoutSource } = player();
  expectOne(validatePlayers([withoutSource]), /source must be an object/);
  expectOne(errorsFor({ source: { site: '', definitive: true } }), /source.site/);
  expectOne(errorsFor({ source: { site: 'nhl.com', definitive: 'yes' } }), /source.definitive must be a boolean/);
});

test('birthDate must be null or a real YYYY-MM-DD date', () => {
  assert.deepEqual(errorsFor({ birthDate: null }), []);
  assert.deepEqual(errorsFor({ birthDate: '1980-02-29' }), []);
  for (const bad of ['1980-02-30', '1981-02-29', '1980-13-01', '1980-00-10', '1980-1-1', '1980/01/01', '19800101', '1980-01-01T00:00', '', 19800101, undefined]) {
    expectOne(errorsFor({ birthDate: bad }), /invalid birthDate/);
  }
});

test('same lastName, firstName and birthDate is reported as a duplicate', () => {
  const dup = validatePlayers([player(), player({ playerId: 2 })]);
  expectOne(dup, /playerId 2\): same lastName.firstName.birthDate as playerId 1/);
  assert.deepEqual(validatePlayers([player(), player({ playerId: 2, birthDate: '1971-01-01' })]), []);
  assert.deepEqual(validatePlayers([player(), player({ playerId: 2, firstName: 'Other', name: 'Player, Other' })]), []);
  assert.deepEqual(validatePlayers([player({ birthDate: null }), player({ playerId: 2, birthDate: null })]), []);
});

// ---------------------------------------------------------------- schema v2: wha, notes, WHA-only

const whaBlock = (overrides = {}) => ({
  regularGP: 81,
  playoffGP: 13,
  seasons: [
    { season: '1975-76', regularGP: 60, playoffGP: 13 },
    { season: '1976-77', regularGP: 21, playoffGP: 0 },
  ],
  source: { sites: ['hockey-reference.com', 'hockeydb.com'], definitive: false, retrieved: '2026-10-17' },
  ...overrides,
});

const whaOnly = (overrides = {}) => player({
  playerId: 900001,
  rookieSeason: '1974-75',
  nhl: { regularGP: 0, playoffGP: 0, seasons: [] },
  wha: whaBlock(),
  draft: null,
  qualifiedBy: ['played'],
  source: { site: 'hockey-reference.com', definitive: false, crossCheck: 'hockeydb.com', retrieved: '2026-10-17' },
  ...overrides,
});

test('valid wha blocks: NHL player with WHA games and a WHA-only player', () => {
  assert.deepEqual(validatePlayers([player({ rookieSeason: '1975-76', wha: whaBlock() }), whaOnly({ birthDate: '1950-01-01' })]), []);
  // playoff-only WHA player qualifies as played
  const playoffOnly = whaBlock({ regularGP: 0, playoffGP: 2, seasons: [{ season: '1978-79', regularGP: 0, playoffGP: 2 }] });
  assert.deepEqual(validatePlayers([whaOnly({ wha: playoffOnly })]), []);
});

test('wha totals, season labels, range and duplicates are checked', () => {
  expectOne(errorsFor({ rookieSeason: '1970-71', wha: whaBlock({ regularGP: 80 }) }), /wha.regularGP 80 does not equal season sum 81/);
  expectOne(errorsFor({ rookieSeason: '1970-71', wha: whaBlock({ playoffGP: 12 }) }), /wha.playoffGP 12 does not equal season sum 13/);
  const one = (row) => whaBlock({ regularGP: row.regularGP, playoffGP: row.playoffGP, seasons: [row] });
  expectOne(errorsFor({ rookieSeason: '1970-71', wha: one({ season: '1979-80', regularGP: 5, playoffGP: 0 }) }), /wha: season 1979-80 is outside 1972-73..1978-79/);
  expectOne(errorsFor({ rookieSeason: '1970-71', wha: one({ season: '1971-72', regularGP: 5, playoffGP: 0 }) }), /outside/);
  expectOne(errorsFor({ rookieSeason: '1970-71', wha: one({ season: '1975-77', regularGP: 5, playoffGP: 0 }) }), /wha: invalid season "1975-77"/);
  expectOne(errorsFor({ rookieSeason: '1970-71', wha: one({ season: '1975-76', team: 'WIN', regularGP: 5, playoffGP: 0 }) }), /no team field/);
  const dup = whaBlock({ regularGP: 10, playoffGP: 0, seasons: [{ season: '1975-76', regularGP: 5, playoffGP: 0 }, { season: '1975-76', regularGP: 5, playoffGP: 0 }] });
  expectOne(errorsFor({ rookieSeason: '1970-71', wha: dup }), /wha: duplicate season row 1975-76/);
  expectOne(errorsFor({ rookieSeason: '1970-71', wha: whaBlock({ regularGP: 0, playoffGP: 0, seasons: [] }) }), /wha.seasons must not be empty/);
  expectOne(errorsFor({ rookieSeason: '1970-71', wha: [] }), /wha must be an object/);
});

test('wha.source needs sites, definitive and a retrieved date', () => {
  const src = (s) => whaBlock({ source: { sites: ['hockey-reference.com'], definitive: false, retrieved: '2026-10-17', ...s } });
  expectOne(errorsFor({ rookieSeason: '1970-71', wha: whaBlock({ source: undefined }) }), /wha.source must be an object/);
  expectOne(errorsFor({ rookieSeason: '1970-71', wha: src({ sites: [] }) }), /wha.source.sites/);
  expectOne(errorsFor({ rookieSeason: '1970-71', wha: src({ definitive: 'no' }) }), /wha.source.definitive/);
  expectOne(errorsFor({ rookieSeason: '1970-71', wha: src({ retrieved: '2026-13-01' }) }), /wha.source.retrieved/);
});

test('qualifiedBy "played" counts NHL or WHA Jets games', () => {
  // WHA games only -> must be played
  expectOne(validatePlayers([whaOnly({ qualifiedBy: [] })]), /qualifiedBy must be a non-empty array/);
  const draftedWha = draftedOnly({ rookieSeason: '1975-76', wha: whaBlock(), qualifiedBy: ['drafted'] });
  expectOne(validatePlayers([draftedWha]), /has Jets GP \(NHL or WHA\) but qualifiedBy lacks "played"/);
  assert.deepEqual(validatePlayers([draftedOnly({ rookieSeason: '1975-76', wha: whaBlock(), qualifiedBy: ['played', 'drafted'] })]), []);
});

test('reserved ids are for WHA Jets players never in the NHL; WHA players with an NHL id are fine anywhere', () => {
  // WHA Jets player with an NHL career elsewhere: real NHL id, no NHL Jets games, NHL draft
  const draft = { year: 1976, team: 'AFM', round: 4, overall: 64, amateur: 'Djurgardens IF Stockholm (SEL)' };
  assert.deepEqual(validatePlayers([whaOnly({ playerId: 8449887, draft })]), []);
  expectOne(validatePlayers([whaOnly({ playerId: 900000 })]), /reserved and never issued/);
  expectOne(validatePlayers([whaOnly({ wha: undefined, qualifiedBy: ['drafted'], draft: player().draft })]), /requires a wha block/);
  const withNhl = whaOnly({ nhl: player().nhl, qualifiedBy: ['played'] });
  expectOne(validatePlayers([withNhl]), /must have empty nhl.seasons/);
  assert.deepEqual(validatePlayers([whaOnly({ rookieSeason: '1972-73' })]), []); // earlier WHA season elsewhere
});

test('validateIdMap: retired reserved ids must not be used and their NHL id must be present', () => {
  const ids = { assignments: [
    { key: 'hr:a', playerId: 900001 },
    { key: 'hr:b', playerId: 900002, retiredFor: { nhlPlayerId: 8449887, basis: 'x' } },
  ] };
  assert.deepEqual(validateIdMap([{ playerId: 900001 }, { playerId: 8449887 }], ids), []);
  const errs = validateIdMap([{ playerId: 900001 }, { playerId: 900002 }], ids);
  assert.equal(errs.length, 2, errs.join('\n'));
  assert.match(errs[0], /reserved id 900002 .*retired.*still used/);
  assert.match(errs[1], /8449887, which is not in players.json/);
});

test('notes and needsReview types', () => {
  assert.deepEqual(errorsFor({ notes: ['birthDate corrected 1959-07-02 -> 1959-06-02: Wikipedia'], needsReview: ['birthDate'] }), []);
  expectOne(errorsFor({ notes: 'x' }), /notes must be an array of non-empty strings/);
  expectOne(errorsFor({ notes: [''] }), /notes must be an array/);
  expectOne(errorsFor({ needsReview: [] }), /needsReview must be a non-empty array/);
  expectOne(errorsFor({ needsReview: ['birthDate', 'birthDate'] }), /needsReview has duplicates/);
  expectOne(errorsFor({ needsReview: ['wha'] }), /needsReview names "wha", which is not a field/);
  assert.deepEqual(errorsFor({ rookieSeason: '1970-71', wha: whaBlock(), needsReview: ['wha'] }), []);
});

test('top-level source stays required for WHA-only players', () => {
  const { source, ...rest } = whaOnly();
  expectOne(validatePlayers([rest]), /source must be an object/);
});
