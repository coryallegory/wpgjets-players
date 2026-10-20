import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCards } from '../scripts/validate.mjs';
import { buildDesired, diffCards } from '../scripts/import-cards.mjs';

const gp = { regularGP: 10, playoffGP: 0, seasons: [] };
const none = { regularGP: 0, playoffGP: 0, seasons: [] };
const players = [
  { playerId: 1, name: 'A, A', nhl: gp },
  { playerId: 2, name: 'B, B', nhl: none },
  { playerId: 3, name: 'C, C', nhl: none, wha: gp },
];
const rec = (o = {}) => ({
  status: 'chosen',
  chosen: { set: '2011 Upper Deck', year: 2011, season: '2011-12', brand: 'Upper Deck', subset: 'Young Guns', cardNumber: '248', urls: { scp: 'https://www.sportscardspro.com/game/x' } },
  rule: 'verified-young-guns', confidence: 'high', source: 'owner', checkedOn: '2026-10-19',
  decidedOn: '2026-10-19', decidedBy: 'owner', basis: 'owner-verified-young-guns', ...o,
});
const verified = [{ playerId: 1, season: '2011-12', cardNumber: '248' }];

test('valid cards.json produces no errors', () => {
  const noCard = { status: 'no-card', chosen: null, source: 'page', decidedOn: '2026-10-19', decidedBy: 'owner', basis: 'page-approval', reason: 'none exists' };
  assert.deepEqual(validateCards({ 1: rec(), 3: noCard }, players, verified), []);
});

test('never-played and unknown players cannot have records', () => {
  assert.match(validateCards({ 2: rec({ basis: 'owner-confirmed' }) }, players, verified).join(), /never played/);
  assert.match(validateCards({ 99: rec({ basis: 'owner-confirmed' }) }, players, verified).join(), /not in players\.json/);
});

test('field, status, url and verified-list rules', () => {
  const errs = (o, ver = verified) => validateCards({ 1: rec(o) }, players, ver).join('\n');
  assert.match(errs({ status: 'maybe' }), /status must be/);
  assert.match(errs({ basis: 'x' }), /basis must be/);
  assert.match(errs({ chosen: null }), /chosen must be an object/);
  assert.match(errs({ status: 'no-card' }), /chosen: null/);
  assert.match(errs({ chosen: { ...rec().chosen, urls: { scp: 'http://x' } } }), /https/);
  assert.match(errs({ chosen: { ...rec().chosen, cardNumber: '249' } }), /does not match the owner-verified/);
  assert.match(errs({}, []), /not in young-guns-verified/);
  assert.match(errs({ decidedOn: '2026-02-30' }), /decidedOn/);
});

const cand = (o = {}) => ({ set: '1999 O-Pee-Chee Chrome', scpYear: '1999', season: '1999-00', brand: 'O-Pee-Chee', cardNumber: '297', sourceIds: { scp: null, comc: 'comc-1' }, comcUrl: 'https://www.comc.com/c', url: null, confidence: 'medium', ...o });

test('importer: approvals join to candidates, notes-only and never-played are skipped', () => {
  const baseline = [{ playerId: 1, rule: 'r', source: 's', checkedOn: '2026-10-19', candidates: [cand()] }];
  const pageDecisions = [
    { playerId: 1, action: 'approve', scpId: 'comc-1', decidedAt: '2026-10-19T20:00:00Z', note: 'ok' },
    { playerId: 3, action: 'none', note: 'leaning' },
    { playerId: 2, action: 'no-card', decidedAt: '2026-10-19T20:00:00Z' },
  ];
  const { desired, warnings } = buildDesired({ players, baseline, yg: [], pageDecisions });
  assert.deepEqual([...desired.keys()], [1]);
  const r = desired.get(1);
  assert.equal(r.basis, 'page-approval');
  assert.equal(r.chosen.urls.comc, 'https://www.comc.com/c');
  assert.equal(r.note, 'ok');
  assert.equal(r.confidence, 'medium');
  assert.equal(warnings.filter((w) => w.startsWith('page decision')).length, 1);
  assert.deepEqual(validateCards(Object.fromEntries(desired), players, []), []);
});

test('importer: diff reports added and changed, keeps records no source produced', () => {
  const a = rec({ basis: 'owner-confirmed' });
  const existing = { 1: a, 3: rec({ basis: 'owner-confirmed' }) };
  const desired = new Map([[1, { ...a, note: 'changed' }], [4, a]]);
  const d = diffCards(existing, desired);
  assert.deepEqual([d.added, d.changed], [[4], [1]]);
  assert.ok(d.result[3]);
});
