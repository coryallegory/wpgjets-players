import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile } from '../scripts/reconcile-wha.mjs';
import { mergeWha, summarize } from '../scripts/merge-wha-into-players.mjs';
import { validatePlayers } from '../scripts/validate.mjs';

// ---------------------------------------------------------------- fixtures

const seasons = (...rows) => rows.map(([season, regularGP, playoffGP]) => ({ season, regularGP, playoffGP }));
function src(sourceId, name, birthDate, rows, extra = {}) {
  const [firstName, ...rest] = name.split(' ');
  const s = seasons(...rows);
  return {
    sourceId, name, fullName: null, nickname: null, firstName, lastName: rest.join(' '), birthDate,
    birthplace: null, country: 'CAN', position: 'D', positionNhlStyle: 'D', seasons: s,
    totals: { regularGP: s.reduce((t, x) => t + x.regularGP, 0), playoffGP: s.reduce((t, x) => t + x.playoffGP, 0) },
    ...extra,
  };
}
const HR = {
  generatedAt: '2026-10-17T17:23:58.902Z',
  players: [
    src('longba01', 'Barry Long', '1949-01-03', [['1976-77', 71, 20], ['1977-78', 78, 9]]),
    src('lesukbi01', 'Bill Lesuk', '1946-11-01', [['1975-76', 81, 13]], { position: 'LW', positionNhlStyle: 'L' }),
    src('holdebi01', 'Bill Holden', '1949-07-23', [['1972-73', 1, 0]], { position: 'G', positionNhlStyle: 'G' }),
    src('grattje01', 'Jean-Guy Gratton', '1947-03-08', [['1972-73', 71, 12]], { position: 'RW', positionNhlStyle: 'R' }),
  ],
};
const DB = {
  generatedAt: '2026-10-17T17:20:48.067Z',
  players: [
    src('3193', 'Barry Long', '1949-01-03', [['1976-77', 71, 20], ['1977-78', 78, 9]]),
    src('3123', 'Bill Lesuk', '1946-11-01', [['1975-76', 81, 13]], { position: 'L', positionNhlStyle: 'L' }),
    src('14121', 'Bill Holden', null, [['1972-73', 1, 0]], { position: 'G', positionNhlStyle: 'G' }),
    src('8744', 'Jean-Guy Gratton', '1949-03-08', [['1972-73', 71, 12]], { position: 'R', positionNhlStyle: 'R' }),
  ],
};
function v1(playerId, firstName, lastName, birthDate, positions, rows, extra = {}) {
  const s = rows.map(([season, regularGP, playoffGP]) => ({ season, team: 'WIN', regularGP, playoffGP }));
  return {
    playerId, firstName, lastName, name: `${lastName}, ${firstName}`, country: 'CAN', birthDate, positions,
    rookieSeason: rows.length ? '1972-73' : null,
    jets: { regularGP: s.reduce((t, x) => t + x.regularGP, 0), playoffGP: s.reduce((t, x) => t + x.playoffGP, 0), seasons: s },
    draft: null, qualifiedBy: rows.length ? ['played'] : ['drafted'],
    source: { site: 'nhl.com', definitive: true, retrieved: '2026-10-17' },
    ...extra,
  };
}
// NHL layer as seeded by init:players (schema v1, `jets`); Long has the nhl.com birth date typo.
const PLAYERS_V1 = [
  v1(8448804, 'Bill', 'Lesuk', '1946-11-01', ['R'], [['1979-80', 49, 0]]),
  v1(8448876, 'Barry', 'Long', '1949-01-31', ['D'], [['1980-81', 65, 0], ['1981-82', 5, 0]]),
  v1(8455409, 'Markus', 'Akerblom', '1969-11-22', [], [], { draft: { year: 1988, team: 'WIN', round: 7, overall: 127, amateur: null } }),
];
const NHL_COM_BIRTHDATES = new Map(PLAYERS_V1.map((p) => [p.playerId, p.birthDate]));
const LONG_DECISION = { id: 'nhl:hr:longba01:8448876', resolution: 'same-person', note: 'Wikipedia: born 1949-01-03, Red Deer' };

// The ids file as reconcile:wha would have written it (Gratton, Holden are WHA-only; Long pending).
const IDS = reconcile({ hr: HR, db: DB, nhl: PLAYERS_V1, decisions: { decisions: [] }, ids: { assignments: [] } }).idsFile;

const rec = (players, decisions = [LONG_DECISION], ids = IDS) =>
  reconcile({ hr: structuredClone(HR), db: structuredClone(DB), nhl: players, decisions: { decisions }, ids, nhlBirthDates: NHL_COM_BIRTHDATES });
const merge = (players, opts = { allowOpen: true }, decisions) => mergeWha(players, rec(players, decisions), opts);
const byName = (players, last) => players.find((p) => p.lastName === last);

// ---------------------------------------------------------------- tests

test('refuses while review items are open unless --allow-open', () => {
  assert.throws(() => merge(PLAYERS_V1, {}), /1 review item\(s\) open[\s\S]*birthdate:hr:grattje01/);
});

test('refuses when reconcile would issue new reserved ids', () => {
  const r = reconcile({ hr: HR, db: DB, nhl: PLAYERS_V1, decisions: { decisions: [LONG_DECISION] }, ids: { assignments: [] } });
  assert.throws(() => mergeWha(PLAYERS_V1, r, { allowOpen: true }), /npm run reconcile:wha/);
});

test('--allow-open: migrates jets -> nhl, extends matched players, adds WHA-only players, marks provisional', () => {
  const input = structuredClone(PLAYERS_V1);
  const { players, migrated } = merge(input);
  assert.deepEqual(input, PLAYERS_V1, 'input not modified');
  assert.equal(migrated, 3);
  assert.deepEqual(validatePlayers(players), []);
  assert.deepEqual(players.map((p) => p.name), ['Akerblom, Markus', 'Gratton, Jean-Guy', 'Holden, Bill', 'Lesuk, Bill', 'Long, Barry']);
  assert.ok(players.every((p) => p.jets === undefined && p.nhl));

  const long = byName(players, 'Long');
  assert.equal(long.playerId, 8448876);
  assert.equal(long.birthDate, '1949-01-03');
  assert.deepEqual(Object.keys(long), ['playerId', 'firstName', 'lastName', 'name', 'country', 'birthDate', 'positions', 'rookieSeason', 'nhl', 'wha', 'draft', 'qualifiedBy', 'source', 'notes']);
  assert.deepEqual(long.wha.seasons, seasons(['1976-77', 71, 20], ['1977-78', 78, 9]));
  assert.equal(long.wha.regularGP, 149);
  assert.equal(long.wha.source.retrieved, '2026-10-17');
  assert.ok(long.notes.includes('birthDate corrected 1949-01-31 -> 1949-01-03 (nhl.com value replaced): Hockey-Reference and hockeydb agree'));
  assert.deepEqual(byName(players, 'Lesuk').positions, ['R'], 'NHL positions kept');

  const gratton = byName(players, 'Gratton');
  assert.ok(gratton.playerId >= 900001);
  assert.equal(gratton.birthDate, '1947-03-08');
  assert.deepEqual(gratton.needsReview, ['birthDate']);
  assert.equal(gratton.rookieSeason, null);
  assert.deepEqual(gratton.positions, ['R']);
  assert.equal(byName(players, 'Akerblom').wha, undefined);
});

test('idempotent: merging the merged file again changes nothing', () => {
  const once = merge(structuredClone(PLAYERS_V1)).players;
  const twice = merge(structuredClone(once));
  assert.equal(JSON.stringify(twice.players), JSON.stringify(once));
  assert.equal(twice.migrated, 0);
  const s = summarize(once, twice.players);
  assert.deepEqual([s.added, s.updated, s.removed, s.orderChanged], [0, 0, 0, false]);
});

test('keeps hand edits; resolving a review item later updates birthDate and clears needsReview/provisional note', () => {
  const once = merge(structuredClone(PLAYERS_V1)).players;
  const edited = structuredClone(once);
  const g = byName(edited, 'Gratton');
  g.notes.unshift('owner: card checked');
  g.country = 'XXX';
  byName(edited, 'Lesuk').notes = ['owner note'];
  byName(edited, 'Holden').positions = ['G', 'D'];

  const decisions = [LONG_DECISION, { id: 'birthdate:hr:grattje01', resolution: 'use-db', note: 'obituary' }];
  const { players } = merge(edited, {}, decisions); // nothing open now: no --allow-open needed
  const g2 = byName(players, 'Gratton');
  assert.equal(g2.birthDate, '1949-03-08');
  assert.equal(g2.needsReview, undefined);
  assert.equal(g2.country, 'XXX');
  assert.deepEqual(g2.notes, ['owner: card checked', 'birthDate 1949-03-08 by owner decision birthdate:hr:grattje01: obituary']);
  assert.deepEqual(byName(players, 'Lesuk').notes, ['owner note', 'WHA position per Hockey-Reference L (LW); NHL positions R kept']);
  assert.deepEqual(byName(players, 'Holden').positions, ['G', 'D']);
});

test('--allow-open skips WHA players whose NHL match is still pending', () => {
  const { players, warnings } = merge(structuredClone(PLAYERS_V1), { allowOpen: true }, []);
  assert.equal(players.length, 5); // Long stays an NHL-only record; not added as a new player
  assert.equal(byName(players, 'Long').wha, undefined);
  assert.equal(byName(players, 'Long').birthDate, '1949-01-31');
  assert.ok(warnings.some((w) => /Long, Barry: WHA<->NHL match still pending/.test(w)));
});

test('summarize reports added and updated players but not the jets -> nhl rename', () => {
  const { players } = merge(structuredClone(PLAYERS_V1));
  const s = summarize(PLAYERS_V1, players);
  assert.equal(s.added, 2);
  assert.equal(s.updated, 2); // Lesuk (wha, notes), Long (birthDate, wha, notes); Akerblom only migrated
  assert.ok(s.lines.some((l) => /birthDate: "1949-01-31" -> "1949-01-03"/.test(l)));
});
