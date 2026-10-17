import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlayers, sortableName } from '../scripts/validate.mjs';

const player = (overrides = {}) => ({
  playerId: 1,
  firstName: 'Test',
  lastName: 'Player',
  name: 'Player, Test',
  country: 'CAN',
  positions: ['C'],
  rookieSeason: '1990-91',
  jets: {
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
  player({ rookieSeason: null, jets: { regularGP: 0, playoffGP: 0, seasons: [] }, qualifiedBy: ['drafted'], ...overrides });

const errorsFor = (overrides) => validatePlayers([player(overrides)]);
const expectOne = (errors, pattern) => {
  assert.equal(errors.length, 1, errors.join('\n'));
  assert.match(errors[0], pattern);
};

test('valid players produce no errors', () => {
  const noDraft = player({ playerId: 3, draft: null, qualifiedBy: ['played'], rookieSeason: null });
  assert.deepEqual(validatePlayers([player(), draftedOnly({ playerId: 2 }), noDraft]), []);
});

test('non-array input is reported', () => {
  assert.deepEqual(validatePlayers({}), ['players must be an array']);
});

test('duplicate and non-numeric playerId are reported', () => {
  expectOne(validatePlayers([player(), player()]), /duplicate playerId 1/);
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
  assert.deepEqual(errorsFor({ rookieSeason: null }), []);
  expectOne(errorsFor({ rookieSeason: '1990-95' }), /invalid rookieSeason/);
  expectOne(errorsFor({ rookieSeason: '1990/91' }), /invalid rookieSeason/);
  expectOne(errorsFor({ rookieSeason: undefined }), /invalid rookieSeason/);
});

test('jets season rows are checked', () => {
  const row = { season: '1990-91', team: 'WIN', regularGP: 100, playoffGP: 3 };
  const jets = (r) => ({ regularGP: 100, playoffGP: 3, seasons: [r] });
  expectOne(errorsFor({ jets: jets({ ...row, season: '1990-95' }) }), /invalid season "1990-95"/);
  expectOne(errorsFor({ jets: jets({ ...row, team: 'ATL' }) }), /invalid jets team "ATL"/);
  expectOne(errorsFor({ jets: jets({ ...row, regularGP: -1 }) }), /regularGP must be a non-negative integer/);
  expectOne(errorsFor({ jets: jets({ ...row, playoffGP: 1.5 }) }), /playoffGP must be a non-negative integer/);
  expectOne(errorsFor({ qualifiedBy: ['drafted'], jets: { regularGP: 0, playoffGP: 0, seasons: 'x' } }), /seasons must be an array/);
});

test('jets totals must equal season sums', () => {
  const base = player().jets;
  expectOne(errorsFor({ jets: { ...base, regularGP: 99 } }), /regularGP 99 does not equal season sum 100/);
  expectOne(errorsFor({ jets: { ...base, playoffGP: 4 } }), /playoffGP 4 does not equal season sum 3/);
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
  expectOne(errorsFor({ qualifiedBy: ['drafted'] }), /Jets GP but qualifiedBy lacks "played"/);
  expectOne(validatePlayers([draftedOnly({ qualifiedBy: ['played', 'drafted'] })]), /"played" but Jets GP is 0/);
  expectOne(validatePlayers([draftedOnly({ draft: null })]), /"drafted" but draft is null/);
});

test('source requires site and boolean definitive', () => {
  const { source, ...withoutSource } = player();
  expectOne(validatePlayers([withoutSource]), /source must be an object/);
  expectOne(errorsFor({ source: { site: '', definitive: true } }), /source.site/);
  expectOne(errorsFor({ source: { site: 'nhl.com', definitive: 'yes' } }), /source.definitive must be a boolean/);
});
