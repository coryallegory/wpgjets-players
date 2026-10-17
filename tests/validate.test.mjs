import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlayers } from '../scripts/validate.mjs';

const player = (overrides = {}) => ({
  playerId: 1,
  name: 'Test Player',
  seasons: ['1990-91', '1991-92'],
  source: { site: 'https://example.com' },
  ...overrides,
});

test('valid players produce no errors', () => {
  assert.deepEqual(validatePlayers([player(), player({ playerId: 2, seasons: [] })]), []);
});

test('duplicate playerId is reported', () => {
  const errors = validatePlayers([player(), player({ name: 'Other' })]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /duplicate playerId 1/);
});

test('malformed season string is reported', () => {
  const errors = validatePlayers([player({ seasons: ['1990-91', '1991/92'] })]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /invalid season "1991\/92"/);
});

test('non-consecutive season string is reported', () => {
  const errors = validatePlayers([player({ seasons: ['1990-95'] })]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /invalid season/);
});

test('missing source is reported', () => {
  const { source, ...withoutSource } = player();
  const errors = validatePlayers([withoutSource]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /source must be an object/);
});

test('non-array input is reported', () => {
  assert.deepEqual(validatePlayers({}), ['players must be an array']);
});
