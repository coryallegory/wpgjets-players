// WHA-only-for-the-Jets players with an NHL career elsewhere (real NHL ids replace reserved ids),
// the major-league rookieSeason, and the pure helpers behind them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, whaRookieSeason, validateIdsFile, nhlLayer } from '../scripts/wha/reconcile-wha.mjs';
import { mergeWha, summarize } from '../scripts/wha/merge-wha-into-players.mjs';
import { validatePlayers, validateIdMap } from '../scripts/validate.mjs';
import { rookieSeason, firstLeagueSeason } from '../scripts/get-nhldata-jets.mjs';
import { birthRelation, classifyCandidate, decide, draftFrom, decisionAlternates, nhlGames } from '../scripts/wha/get-nhldata-wha-players.mjs';
import { parseCareerSeasons, firstCareerSeason } from '../scripts/wha/get-hockeyreference-wha.mjs';
import { indexDecisions } from '../scripts/wha/reconcile-wha.mjs';

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
    src('nilsske01', 'Kent Nilsson', '1956-08-31', [['1977-78', 80, 9], ['1978-79', 78, 10]], { country: 'SWE', position: 'C', positionNhlStyle: 'C' }),
    src('ashbo01', 'Bob Ash', '1943-09-29', [['1973-74', 76, 4]]),
    src('amodemi01', 'Mike Amodeo', '1952-06-22', [['1977-78', 3, 7], ['1978-79', 64, 0]]),
  ],
};
const DB = {
  generatedAt: '2026-10-17T17:20:48.067Z',
  players: [
    src('3977', 'Kent Nilsson', '1956-08-31', [['1977-78', 80, 9], ['1978-79', 78, 10]], { country: 'SWE', position: 'C', positionNhlStyle: 'C' }),
    src('10009', 'Bob Ash', '1943-09-29', [['1973-74', 76, 4]]),
    src('60', 'Mike Amodeo', '1952-06-22', [['1977-78', 3, 7], ['1978-79', 64, 0]]),
  ],
};
// NHL layer: Amodeo played for Jets 1.0 (WHA Jets too); nhl.com rookieSeason now counts WHA seasons.
const AMODEO = {
  playerId: 8444923, firstName: 'Mike', lastName: 'Amodeo', name: 'Amodeo, Mike', country: 'CAN', birthDate: '1952-06-22',
  positions: ['D'], rookieSeason: '1979-80',
  nhl: { regularGP: 19, playoffGP: 0, seasons: [{ season: '1979-80', team: 'WIN', regularGP: 19, playoffGP: 0 }] },
  draft: null, qualifiedBy: ['played'], source: { site: 'nhl.com', definitive: true, retrieved: '2026-10-17' },
};
const AKERBLOM = {
  playerId: 8455409, firstName: 'Markus', lastName: 'Akerblom', name: 'Akerblom, Markus', country: 'SWE', birthDate: '1969-11-22',
  positions: [], rookieSeason: null, nhl: { regularGP: 0, playoffGP: 0, seasons: [] },
  draft: { year: 1988, team: 'WIN', round: 7, overall: 127, amateur: null }, qualifiedBy: ['drafted'],
  source: { site: 'nhl.com', definitive: true, retrieved: '2026-10-17' },
};
const NHL_ROOKIE = new Map([[8444923, '1972-73'], [8455409, null]]);
const KENT_DRAFT = { year: 1976, team: 'AFM', round: 4, overall: 64, amateur: 'Djurgardens IF Stockholm (SEL)' };
const lookupEntry = (over = {}) => ({
  key: 'hr:nilsske01', reservedId: 900002, status: 'matched', nhlPlayerId: 8449887,
  landingUrl: 'https://api-web.nhle.com/v1/player/8449887/landing', basis: 'birthDate+lastName+firstName',
  landing: { firstName: 'Kent', lastName: 'Nilsson', birthDate: '1956-08-31', birthCountry: 'SWE', draftDetails: { year: 1976 } },
  draft: KENT_DRAFT, firstNhlSeason: '1979-80', firstWhaSeason: '1977-78', rookieSeason: '1977-78', candidates: [],
  ...over,
});
const LOOKUP = { generatedAt: '2026-10-17T20:00:00.000Z', players: [lookupEntry()] };
// Hockey-Reference career table rows: Ash played WHA Ottawa in 1972-73 before the Jets.
const HR_CAREERS = new Map([['ashbo01', [
  { season: '1972-73', league: 'WHA', team: 'OTN', regularGP: 70, playoffGP: 0 },
  { season: '1973-74', league: 'WHA', team: 'WNJ', regularGP: 76, playoffGP: 4 },
]]]);

const reservedIds = () => reconcile({ hr: HR, db: DB, nhl: [AMODEO, AKERBLOM], decisions: { decisions: [] }, ids: { assignments: [] } }).idsFile;
const rec = (players, { ids, lookup = LOOKUP, decisions = [], hrCareers = HR_CAREERS } = {}) =>
  reconcile({ hr: structuredClone(HR), db: structuredClone(DB), nhl: players, decisions: { decisions }, ids, nhlLookup: lookup, hrCareers });

/** players.json before this change: everyone WHA-only on reserved ids, rookieSeason null. */
function legacyPlayers() {
  const ids = reservedIds();
  const r = rec([AMODEO, AKERBLOM], { ids, lookup: null, hrCareers: null });
  const players = mergeWha([AMODEO, AKERBLOM], r, {}).players;
  for (const p of players) if (p.playerId >= 900000 && p.playerId < 1000000) p.rookieSeason = null;
  return { ids, players };
}
const byLast = (players, last) => players.find((p) => p.lastName === last);

// ---------------------------------------------------------------- reconcile

test('reconcile: a matched lookup retires the reserved id for the real NHL id (append-only ids file)', () => {
  const ids = reservedIds();
  const kentReserved = ids.assignments.find((a) => a.key === 'hr:nilsske01').playerId;
  const r = rec([AMODEO, AKERBLOM], { ids });
  assert.equal(r.idsChanged, true);
  const a = r.idsFile.assignments.find((x) => x.key === 'hr:nilsske01');
  assert.equal(a.playerId, kentReserved, 'reserved id itself never changes');
  assert.deepEqual(a.retiredFor, { nhlPlayerId: 8449887, basis: 'nhl-wha-lookup birthDate+lastName+firstName', evidence: LOOKUP.players[0].landingUrl, verified: '2026-10-17' });
  assert.equal(r.idsFile.assignments.length, ids.assignments.length);
  const m = r.report.merge.find((x) => x.key === 'hr:nilsske01');
  assert.equal(m.action, 'wha-nhl-career');
  assert.equal(m.playerId, 8449887);
  assert.equal(m.retiredId, kentReserved);
  assert.equal(m.record.playerId, 8449887);
  assert.deepEqual(m.record.draft, KENT_DRAFT);
  assert.equal(m.record.rookieSeason, '1977-78');
  assert.ok(m.notes.some((n) => n.startsWith(`playerId 8449887 is the nhl.com player id (${LOOKUP.players[0].landingUrl}); reserved WHA-only id ${kentReserved} retired`)));
  // Second run with the recorded ids file: stable, no further id changes.
  const again = rec([AMODEO, AKERBLOM], { ids: r.idsFile });
  assert.equal(again.idsChanged, false);
  assert.equal(again.report.merge.find((x) => x.key === 'hr:nilsske01').playerId, 8449887);
  // Without the (gitignored) lookup the committed retirement still applies.
  const noLookup = rec([AMODEO, AKERBLOM], { ids: r.idsFile, lookup: null });
  assert.equal(noLookup.idsChanged, false);
  assert.equal(noLookup.report.merge.find((x) => x.key === 'hr:nilsske01').action, 'wha-nhl-career');
});

test('reconcile: WHA-only players without an NHL career get the earliest WHA season on any team as rookieSeason', () => {
  const r = rec([AMODEO, AKERBLOM], { ids: reservedIds() });
  const ash = r.report.merge.find((x) => x.key === 'hr:ashbo01');
  assert.equal(ash.action, 'new-wha-only');
  assert.equal(ash.record.rookieSeason, '1972-73');
  assert.ok(ash.notes.includes('rookieSeason 1972-73: first WHA regular season on any team per Hockey-Reference career table (no NHL career)'));
  assert.equal(ash.rookieSeason.complete, true);
  const noCareer = rec([AMODEO, AKERBLOM], { ids: reservedIds(), hrCareers: null }).report.merge.find((x) => x.key === 'hr:ashbo01');
  assert.equal(noCareer.record.rookieSeason, '1973-74');
  assert.ok(noCareer.notes.includes('rookieSeason 1973-74: first WHA Jets regular season (no Hockey-Reference career table available) (no NHL career)'));
});

test('reconcile: review candidates become nhlid items; same-person accepts, different-person keeps the reserved id', () => {
  const cand = { nhlPlayerId: 8449887, name: 'Kent Nilsson', birthDate: '1956-08-30', birthCountry: 'SWE', nhlGames: 673, exact: false,
    review: 'same surname and compatible first name; birth date differs slightly (possible typo)', landingUrl: 'u', draft: KENT_DRAFT, rookieSeason: '1977-78' };
  const lookup = { generatedAt: '2026-10-17T20:00:00Z', players: [lookupEntry({ status: 'review', nhlPlayerId: undefined, reviewReason: 'only near candidates', candidates: [cand] })] };
  const ids = reservedIds();
  const open = rec([AMODEO, AKERBLOM], { ids, lookup });
  assert.deepEqual(open.report.reviewItems.map((i) => i.id), ['nhlid:hr:nilsske01:8449887']);
  assert.equal(open.report.merge.find((x) => x.key === 'hr:nilsske01').action, 'new-wha-only');
  assert.throws(() => mergeWha([AMODEO, AKERBLOM], open, {}), /review item/);

  const no = rec([AMODEO, AKERBLOM], { ids, lookup, decisions: [{ id: 'nhlid:hr:nilsske01:8449887', resolution: 'different-person', note: '' }] });
  assert.equal(no.report.reviewItems.length, 0);
  assert.equal(no.idsChanged, false);

  const yes = rec([AMODEO, AKERBLOM], { ids, lookup, decisions: [{ id: 'nhlid:hr:nilsske01:8449887', resolution: 'same-person', note: 'card back' }] });
  assert.equal(yes.idsFile.assignments.find((a) => a.key === 'hr:nilsske01').retiredFor.basis, 'owner decision nhlid:hr:nilsske01:8449887');
  // The accepted NHL record's birth date differs: never overwritten silently -> nhlfacts review item.
  assert.deepEqual(yes.report.reviewItems.map((i) => i.id), ['nhlfacts:hr:nilsske01:birthDate']);
  const kept = rec([AMODEO, AKERBLOM], { ids: yes.idsFile, lookup, decisions: [
    { id: 'nhlid:hr:nilsske01:8449887', resolution: 'same-person', note: 'card back' },
    { id: 'nhlfacts:hr:nilsske01:birthDate', resolution: 'keep-curated', note: '' },
  ] });
  assert.equal(kept.report.reviewItems.length, 0);
  const m = kept.report.merge.find((x) => x.key === 'hr:nilsske01');
  assert.equal(m.birthDate.value, '1956-08-31');
  assert.ok(m.notes.includes('nhl.com birthDate 1956-08-30 differs; 1956-08-31 kept (owner decision nhlfacts:hr:nilsske01:birthDate)'));
  const pendingNote = yes.report.merge.find((x) => x.key === 'hr:nilsske01').notes;
  assert.ok(pendingNote.includes('nhl.com birthDate 1956-08-30 differs; 1956-08-31 kept (pending review nhlfacts:hr:nilsske01:birthDate)'));
});

test('reconcile: a birth date the owner already recorded as an alternate is settled (no review); country mismatch is reviewed', () => {
  const lookup = { generatedAt: 'x', players: [lookupEntry({ landing: { birthDate: '1956-09-01', birthCountry: 'FIN' } })] };
  const decisions = [{ id: 'birthdate:hr:nilsske01', resolution: 'use-hr', note: 'ALTERNATE 1956-09-01 (nhl.com) kept here' }];
  // (the decision id is otherwise stale in this fixture; it still marks the alternate as settled)
  const r = rec([AMODEO, AKERBLOM], { ids: reservedIds(), lookup, decisions });
  assert.deepEqual(r.report.reviewItems.map((i) => i.id), ['nhlfacts:hr:nilsske01:country']);
  const notes = r.report.merge.find((x) => x.key === 'hr:nilsske01').notes;
  assert.ok(notes.includes('nhl.com birthDate 1956-09-01 differs; 1956-08-31 kept (alternate recorded in owner decision birthdate:hr:nilsske01)'));
  assert.ok(notes.includes('nhl.com country FIN differs; SWE kept (pending review nhlfacts:hr:nilsske01:country)'));
  const useNhl = rec([AMODEO, AKERBLOM], { ids: reservedIds(), lookup, decisions: [...decisions, { id: 'nhlfacts:hr:nilsske01:country', resolution: 'use-nhl', note: '' }] });
  assert.equal(useNhl.report.merge.find((x) => x.key === 'hr:nilsske01').record.country, 'FIN');
});

test('reconcile: a lookup that contradicts a recorded retirement fails loudly', () => {
  const ids = rec([AMODEO, AKERBLOM], { ids: reservedIds() }).idsFile;
  const lookup = { generatedAt: 'x', players: [lookupEntry({ nhlPlayerId: 8400000 })] };
  assert.throws(() => rec([AMODEO, AKERBLOM], { ids, lookup }), /retiredFor 8449887.*8400000/);
});

test('validateIdsFile: retiredFor must be a unique, real NHL id with a basis; nhlLayer skips retirement targets', () => {
  const ok = { assignments: [{ key: 'a', playerId: 900001, retiredFor: { nhlPlayerId: 8449887, basis: 'b' } }] };
  assert.doesNotThrow(() => validateIdsFile(ok));
  assert.throws(() => validateIdsFile({ assignments: [{ key: 'a', playerId: 900001, retiredFor: { nhlPlayerId: 900002, basis: 'b' } }] }), /real/);
  assert.throws(() => validateIdsFile({ assignments: [{ key: 'a', playerId: 900001, retiredFor: { nhlPlayerId: 8449887 } }] }), /basis/);
  assert.throws(() => validateIdsFile({ assignments: [
    { key: 'a', playerId: 900001, retiredFor: { nhlPlayerId: 8449887, basis: 'b' } },
    { key: 'b', playerId: 900002, retiredFor: { nhlPlayerId: 8449887, basis: 'b' } },
  ] }), /two keys/);
  const layer = nhlLayer([AMODEO, { ...AKERBLOM, playerId: 8449887 }], null, new Set([8449887]));
  assert.deepEqual(layer.map((p) => p.playerId), [8444923]);
});

test('whaRookieSeason: earliest of nhl.com, Hockey-Reference career and first WHA Jets regular season', () => {
  const jets = seasons(['1975-76', 0, 3], ['1976-77', 40, 0]);
  assert.deepEqual(whaRookieSeason(jets, null, null), { season: '1976-77', basis: 'first WHA Jets regular season (no Hockey-Reference career table available)', complete: false });
  assert.deepEqual(whaRookieSeason(jets, [{ season: '1974-75', league: 'WHA', team: 'X', regularGP: 1, playoffGP: 0 }], null),
    { season: '1974-75', basis: 'first WHA regular season on any team per Hockey-Reference career table', complete: true });
  assert.match(whaRookieSeason(jets, [{ season: '1971-72', league: 'NHL', team: 'X', regularGP: 1, playoffGP: 0 }], null).basis, /first NHL regular season/);
  assert.equal(whaRookieSeason(jets, [{ season: '1970-71', league: 'AHL', team: 'X', regularGP: 9, playoffGP: 0 }], null).season, '1976-77');
  assert.equal(whaRookieSeason(jets, [], { rookieSeason: '1968-69' }).season, '1968-69');
  assert.deepEqual(whaRookieSeason(seasons(['1978-79', 0, 2]), null, null), { season: '1978-79', basis: 'first WHA Jets season (playoff games only; no regular-season data)', complete: false });
});

// ---------------------------------------------------------------- merge

test('merge: moves the record to the NHL id, fills draft and rookieSeason, refreshes NHL-layer rookieSeason; idempotent', () => {
  const { ids, players: before } = legacyPlayers();
  const kentReserved = ids.assignments.find((a) => a.key === 'hr:nilsske01').playerId;
  before.find((p) => p.playerId === kentReserved).notes = ['owner: has card'];
  // reconcile:wha first records the retirement (merge refuses otherwise)
  const pending = rec(before, { ids });
  assert.throws(() => mergeWha(before, pending, { nhlRookieSeasons: NHL_ROOKIE }), /retire hr:nilsske01 for NHL id 8449887/);
  const r = rec(before, { ids: pending.idsFile });
  const curatedVariants = { variants: [{ playerId: kentReserved, variants: ['Kenta Nilsson'], source: 'test' }] };
  const { players, renamed, warnings } = mergeWha(before, r, { nhlRookieSeasons: NHL_ROOKIE, sources: { hr: HR.players, db: DB.players }, curatedVariants });
  assert.deepEqual(validatePlayers(players), []);
  assert.deepEqual(validateIdMap(players, r.idsFile), []);
  assert.deepEqual([...renamed], [[kentReserved, 8449887]]);
  assert.deepEqual(warnings, []);

  const kent = byLast(players, 'Nilsson');
  assert.equal(kent.playerId, 8449887);
  assert.equal(Object.keys(kent)[0], 'playerId');
  assert.deepEqual(kent.draft, KENT_DRAFT);
  assert.equal(kent.rookieSeason, '1977-78');
  assert.equal(kent.notes[0], 'owner: has card', 'hand notes kept first');
  assert.ok(kent.notes.includes('Name variants: Kenta Nilsson'), 'name-variants.json may still use the retired id');
  assert.equal(byLast(players, 'Ash').rookieSeason, '1972-73');
  assert.equal(byLast(players, 'Ash').playerId, ids.assignments.find((a) => a.key === 'hr:ashbo01').playerId);
  assert.equal(byLast(players, 'Amodeo').rookieSeason, '1972-73', 'NHL layer: first NHL or WHA season');
  assert.equal(byLast(players, 'Akerblom').rookieSeason, null, 'drafted-only stays null');

  const s = summarize(before, players, renamed);
  assert.equal(s.removed, 0);
  assert.ok(s.lines.includes(`~ 8449887 Nilsson, Kent (was ${kentReserved})`));

  const again = mergeWha(structuredClone(players), rec(players, { ids: r.idsFile }), { nhlRookieSeasons: NHL_ROOKIE, sources: { hr: HR.players, db: DB.players }, curatedVariants });
  assert.equal(JSON.stringify(again.players), JSON.stringify(players));
  assert.equal(again.renamed.size, 0);
});

test('merge: an existing (hand-edited) draft is kept with a warning; rookieSeason notes are replaced, never regressed', () => {
  const { ids, players: before } = legacyPlayers();
  const r1 = rec(before, { ids: rec(before, { ids }).idsFile });
  const once = mergeWha(before, r1, { nhlRookieSeasons: NHL_ROOKIE }).players;
  const edited = structuredClone(once);
  byLast(edited, 'Nilsson').draft = { ...KENT_DRAFT, amateur: 'Djurgarden (Sweden)' };
  byLast(edited, 'Ash').notes.push('owner note');
  // New career evidence (an earlier season elsewhere): value and note are replaced, other notes kept.
  const careers = new Map([['ashbo01', [{ season: '1971-72', league: 'NHL', team: 'X', regularGP: 1, playoffGP: 0 }, ...HR_CAREERS.get('ashbo01')]]]);
  const r2 = rec(edited, { ids: r1.idsFile, hrCareers: careers });
  const { players, warnings } = mergeWha(edited, r2, { nhlRookieSeasons: NHL_ROOKIE });
  assert.equal(byLast(players, 'Nilsson').draft.amateur, 'Djurgarden (Sweden)');
  assert.ok(warnings.some((w) => /draft differs from nhl.com/.test(w)));
  const ash2 = byLast(players, 'Ash');
  assert.equal(ash2.rookieSeason, '1971-72');
  assert.deepEqual(ash2.notes.filter((n) => n.startsWith('rookieSeason ')), ['rookieSeason 1971-72: first NHL regular season on any team per Hockey-Reference career table (no NHL career)']);
  assert.ok(ash2.notes.includes('owner note'));
  // HR cache gone (temp/ is rebuildable): the stored earlier value and its note are kept.
  const r3 = rec(players, { ids: r1.idsFile, hrCareers: null });
  const ash3 = byLast(mergeWha(players, r3, { nhlRookieSeasons: NHL_ROOKIE }).players, 'Ash');
  assert.equal(ash3.rookieSeason, '1971-72');
  assert.deepEqual(ash3.notes, ash2.notes);
});

// ---------------------------------------------------------------- NHL lookup helpers

test('birthRelation and decisionAlternates', () => {
  assert.equal(birthRelation('1951-06-09', '1951-06-09'), 'equal');
  assert.equal(birthRelation('1951-06-09', '1951-09-05', ['1951-09-05']), 'alternate');
  assert.equal(birthRelation('1951-06-09', '1951-09-06'), 'near'); // same year
  assert.equal(birthRelation('1949-12-30', '1950-01-02'), 'near'); // a few days, across years
  assert.equal(birthRelation('1951-06-09', '1953-06-09'), 'different');
  assert.equal(birthRelation(null, '1953-06-09'), 'missing');
  const decisions = indexDecisions({ decisions: [{ id: 'birthdate:hr:labrada01', resolution: 'use-hr', note: 'Owner chose 1951-06-09. ALTERNATE 1951-09-05 (NHL.com bio)' }] });
  assert.deepEqual(decisionAlternates(decisions, 'hr:labrada01'), ['1951-06-09', '1951-09-05']);
  assert.deepEqual(decisionAlternates(decisions, 'hr:other'), []);
});

const landing = (first, last, birthDate, totals = []) => ({ firstName: { default: first }, lastName: { default: last }, birthDate, seasonTotals: totals });
const ours = { lastNames: ['Sjöberg'], nameRecords: [{ firstName: 'Lars-Erik' }], birthDate: '1944-04-05', alternates: [] };

test('classifyCandidate and decide: accept only on surname + birth date + first name, never on names alone', () => {
  const exact = classifyCandidate(ours, landing('Lars', 'Sjoberg', '1944-04-05'));
  assert.deepEqual([exact.surnameOk, exact.birth, exact.firstOk, exact.exact, exact.review], [true, 'equal', true, true, null]);
  const nameOnly = classifyCandidate(ours, landing('Lars', 'Sjoberg', '1950-04-05'));
  assert.equal(nameOnly.exact, false);
  assert.equal(nameOnly.review, null);
  assert.match(classifyCandidate(ours, landing('Lars', 'Sjoberg', '1944-04-06')).review, /differs slightly/);
  assert.match(classifyCandidate(ours, landing('Bengt', 'Sjoberg', '1944-04-05')).review, /not nickname-compatible/);

  const c = (o) => ({ exact: false, review: null, nhlGames: 10, ...o });
  assert.equal(decide([c({ exact: true })]).status, 'matched');
  assert.equal(decide([c({ exact: true, nhlGames: 0 })]).status, 'nhl-record-no-nhl-games');
  assert.equal(decide([c({ exact: true }), c({ exact: true })]).status, 'review');
  assert.equal(decide([c({ exact: true }), c({ review: 'near' })]).status, 'review');
  assert.equal(decide([c({ review: 'near' })]).status, 'review');
  assert.equal(decide([c({}), c({})]).status, 'not-found');
});

test('landing helpers: rookieSeason counts WHA rows; nhlGames counts NHL only; draftFrom uses records.nhl.com amateur club', () => {
  const totals = [
    { season: 19761977, leagueAbbrev: 'SEL', gameTypeId: 2, gamesPlayed: 36 },
    { season: 19771978, leagueAbbrev: 'WHA', gameTypeId: 2, gamesPlayed: 80 },
    { season: 19771978, leagueAbbrev: 'WHA', gameTypeId: 3, gamesPlayed: 9 },
    { season: 19791980, leagueAbbrev: 'NHL', gameTypeId: 2, gamesPlayed: 80 },
    { season: 19791980, leagueAbbrev: 'NHL', gameTypeId: 3, gamesPlayed: 4 },
  ];
  const L = { ...landing('Kent', 'Nilsson', '1956-08-31', totals), draftDetails: { year: 1976, teamAbbrev: 'AFM', round: 4, pickInRound: 10, overallPick: 64 } };
  assert.equal(rookieSeason(L), '1977-78');
  assert.equal(firstLeagueSeason(L, 'NHL'), '1979-80');
  assert.equal(firstLeagueSeason(L, 'WHA'), '1977-78');
  assert.equal(rookieSeason(landing('A', 'B', null, [{ season: 19901991, leagueAbbrev: 'OHL', gameTypeId: 2, gamesPlayed: 60 }])), null);
  assert.equal(nhlGames(L), 84);
  const records = [{ draftYear: 1976, overallPickNumber: 64, amateurClubName: 'Djurgardens IF Stockholm', amateurLeague: 'SEL', roundNumber: 4 }];
  assert.deepEqual(draftFrom(L, records), KENT_DRAFT);
  assert.deepEqual(draftFrom(L, []), { ...KENT_DRAFT, amateur: null });
  assert.equal(draftFrom(landing('A', 'B', null), records), null);
});

test('parseCareerSeasons: whole-career rows from a Hockey-Reference player page; summary and TOT rows skipped', () => {
  const row = (y, team, lg, gp, stat = 'games') =>
    `<tr><th scope="row" data-stat="year_id">${y}</th><td data-stat="team_name_abbr">${team}</td><td data-stat="comp_name_abbr">${lg}</td><td data-stat="${stat}">${gp}</td></tr>`;
  const html = `
    <table id="player_stats"><thead><tr><th scope="col" data-stat="year_id">Season</th></tr></thead><tbody>
      ${row('1972-73', 'OTN', 'WHA', 70)}${row('1973-74', 'TOT', 'WHA', 76)}${row('1973-74', 'WNJ', 'WHA', 40)}${row('1973-74', 'TRT', 'WHA', 36)}
      ${row('1974-75', 'CHI', 'NHL', 2)}<tr><th data-stat="year_id">WHA (2 Yrs)</th><td data-stat="games">146</td></tr>
    </tbody></table>
    <!-- <table id="player_stats_post"><tbody>${row('1973-74', 'WNJ', 'WHA', 4)}</tbody></table> -->`;
  const rows = parseCareerSeasons(html);
  assert.deepEqual(rows, [
    { season: '1972-73', league: 'WHA', team: 'OTN', regularGP: 70, playoffGP: 0 },
    { season: '1973-74', league: 'WHA', team: 'TRT', regularGP: 36, playoffGP: 0 },
    { season: '1973-74', league: 'WHA', team: 'WNJ', regularGP: 40, playoffGP: 4 },
    { season: '1974-75', league: 'NHL', team: 'CHI', regularGP: 2, playoffGP: 0 },
  ]);
  assert.equal(firstCareerSeason(rows), '1972-73');
  assert.equal(firstCareerSeason(rows, ['NHL']), '1974-75');
  // goalies: goalie tables win over skater tables
  const g = parseCareerSeasons(`<table id="goalie_stats"><tbody>${row('1968-69', 'PIT', 'NHL', 29, 'goalie_games')}</tbody></table>
    <table id="player_stats"><tbody>${row('1968-69', 'PIT', 'NHL', 99)}</tbody></table>`);
  assert.deepEqual(g, [{ season: '1968-69', league: 'NHL', team: 'PIT', regularGP: 29, playoffGP: 0 }]);
});
