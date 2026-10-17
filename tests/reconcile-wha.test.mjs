import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normName, firstNamesCompatible, namesCompatible, compareBirthDates, gpKey, proposeBirthDate,
  nhlTier, matchSources, pairDisagreements, assignWhaIds, indexDecisions, resolveItem,
  staleDecisionWarnings, reconcile, renderReview, WHA_ID_START, nhlLayer, isWhaReservedId,
} from '../scripts/reconcile-wha.mjs';

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
function nhlP(playerId, firstName, lastName, birthDate, positions = ['D']) {
  return {
    playerId, firstName, lastName, name: `${lastName}, ${firstName}`, country: 'CAN', birthDate, positions,
    rookieSeason: '1979-80', jets: { regularGP: 10, playoffGP: 0, seasons: [{ season: '1980-81', team: 'WIN', regularGP: 10, playoffGP: 0 }] },
    draft: null, qualifiedBy: ['played'], source: { site: 'nhl.com', definitive: true },
  };
}
const HR = {
  generatedAt: 'x',
  players: [
    src('longba01', 'Barry Long', '1949-01-03', [['1976-77', 71, 20]]),
    src('lesukbi01', 'Bill Lesuk', '1946-11-01', [['1975-76', 81, 13]], { position: 'LW', positionNhlStyle: 'L' }),
    src('sjobela01', 'Lars-Erik Sjöberg', '1944-04-05', [['1974-75', 75, 0]]),
    src('holdebi01', 'Bill Holden', '1949-07-23', [['1972-73', 1, 0]], { position: 'G', positionNhlStyle: 'G' }),
    src('grattje01', 'Jean-Guy Gratton', '1947-03-08', [['1972-73', 71, 12]]),
    src('ashbo01', 'Bob Ash', '1943-09-29', [['1972-73', 76, 13]]),
  ],
};
const DB = {
  generatedAt: 'y',
  players: [
    src('3193', 'Barry Long', '1949-01-03', [['1976-77', 71, 20]]),
    src('3123', 'Bill Lesuk', '1946-11-01', [['1975-76', 81, 13]]),
    src('4988', 'Lars-Erik Sjoberg', '1944-04-05', [['1974-75', 75, 0]]),
    src('14121', 'Bill Holden', null, [['1972-73', 1, 0]]),
    src('8744', 'Jean-Guy Gratton', '1949-03-08', [['1972-73', 71, 12]]),
    src('10009', 'Bob Ash', '1943-09-29', [['1972-73', 76, 12]]),
  ],
};
const NHL = [
  nhlP(8448876, 'Barry', 'Long', '1949-01-31'),
  nhlP(8448804, 'Bill', 'Lesuk', '1946-11-01', ['R']),
  nhlP(8451388, 'Lars', 'Sjoberg', '1944-04-05'),
  nhlP(8447940, 'Mark', 'Holden', '1957-06-12', ['G']),
];
const emptyIds = () => ({ assignments: [] });
const run = (decisions = [], ids = emptyIds()) =>
  reconcile({ hr: structuredClone(HR), db: structuredClone(DB), nhl: structuredClone(NHL), decisions: { decisions }, ids });

// ---------------------------------------------------------------- names

test('normName strips diacritics, case, hyphens and spaces', () => {
  assert.equal(normName('Sjöberg'), 'sjoberg');
  assert.equal(normName('Lindström'), 'lindstrom');
  assert.equal(normName('Jean-Guy'), 'jeanguy');
  assert.equal(normName('Mac Kinnon'), normName('MacKinnon'));
  assert.equal(normName('Søren'), 'soren');
  assert.equal(normName(null), '');
});

test('firstNamesCompatible uses the nickname groups', () => {
  for (const [a, b] of [['Bob', 'Robert'], ['Bobby', 'Rob'], ['Dan', 'Daniel'], ['Chris', 'Christian'], ['Bill', 'William'],
    ['Willy', 'Willie'], ['Jim', 'James'], ['Doug', 'Douglas'], ['Ted', 'Edward'], ['Ed', 'Eddie'], ['Mike', 'Michael'],
    ['Tom', 'Thomas'], ['Ken', 'Kenneth'], ['Gord', 'Gordie'], ['Lars-Erik', 'Lars'], ['Duke', 'Freeman'], ['Danny', 'danny']]) {
    assert.ok(firstNamesCompatible(a, b), `${a} ~ ${b}`);
  }
  assert.ok(!firstNamesCompatible('Bob', 'Dan'));
  assert.ok(!firstNamesCompatible('Gary', 'Gord'));
  assert.ok(!firstNamesCompatible('', 'Gord'));
});

test('namesCompatible also looks at full name given names and nickname', () => {
  assert.ok(namesCompatible({ firstName: 'Willy', fullName: 'Bo Morgan Lindström' }, { firstName: 'Bo' }));
  assert.ok(namesCompatible({ firstName: 'Freeman', nickname: 'Duke' }, { firstName: 'Duke' }));
  assert.ok(namesCompatible({ firstName: 'Perry', fullName: 'Paul Elvin Miller' }, { firstName: 'Paul' }));
  assert.ok(!namesCompatible({ firstName: 'Gary', fullName: 'Gary Edward Smith', nickname: 'Suitcase, Axe' }, { firstName: 'Gord' }));
});

// ---------------------------------------------------------------- dates, tiers

test('compareBirthDates', () => {
  assert.equal(compareBirthDates('1949-01-03', '1949-01-03'), 'equal');
  assert.equal(compareBirthDates('1949-01-03', '1949-01-31'), 'same-year');
  assert.equal(compareBirthDates('1947-03-08', '1949-03-08'), 'different');
  assert.equal(compareBirthDates(null, '1949-03-08'), 'missing');
});

test('gpKey is order independent', () => {
  assert.equal(gpKey(seasons(['1973-74', 1, 2], ['1972-73', 3, 4])), gpKey(seasons(['1972-73', 3, 4], ['1973-74', 1, 2])));
});

test('nhlTier: A exact date, B same year (typo style), C different, null other surname', () => {
  const e = (lastName, ...birthDates) => ({ lastName, birthDates });
  assert.equal(nhlTier(e('Lesuk', '1946-11-01'), nhlP(1, 'Bill', 'Lesuk', '1946-11-01')), 'A');
  assert.equal(nhlTier(e('Long', '1949-01-03'), nhlP(1, 'Barry', 'Long', '1949-01-31')), 'B');
  assert.equal(nhlTier(e('Gibson', '1959-06-02'), nhlP(1, 'John', 'Gibson', '1959-07-02')), 'B');
  assert.equal(nhlTier(e('Smith', '1944-02-04'), nhlP(1, 'Gord', 'Smith', '1949-11-17')), 'C');
  assert.equal(nhlTier(e('Sullivan', '1951-07-25', '1951-06-25'), nhlP(1, 'Peter', 'Sullivan', '1951-07-25')), 'A');
  assert.equal(nhlTier(e('Sjöberg', '1944-04-05'), nhlP(1, 'Lars', 'Sjoberg', '1944-04-05')), 'A');
  assert.equal(nhlTier(e('Smith', '1944-02-04'), nhlP(1, 'Gary', 'Jones', '1944-02-04')), null);
});

test('proposeBirthDate prefers a 2-source value, else HR with conflict', () => {
  assert.deepEqual(
    (({ value, basis, conflict }) => ({ value, basis, conflict }))(proposeBirthDate({ hr: '1951-07-25', db: '1951-06-25', nhl: '1951-07-25' })),
    { value: '1951-07-25', basis: 'majority', conflict: false },
  );
  const p = proposeBirthDate({ hr: '1947-03-08', db: '1949-03-08' });
  assert.equal(p.value, '1947-03-08');
  assert.equal(p.conflict, true);
  assert.equal(proposeBirthDate({ hr: '1949-07-23', db: null }).basis, 'single-source');
  assert.equal(proposeBirthDate({ hr: '1949-01-03', db: '1949-01-03' }).basis, 'all-agree');
  assert.equal(proposeBirthDate({}).conflict, true);
});

// ---------------------------------------------------------------- HR <-> DB

test('matchSources: birth date, GP pattern with missing date, GP pattern with differing date', () => {
  const { auto, review } = matchSources(HR.players, DB.players);
  const basis = Object.fromEntries(auto.map((p) => [p.hr.sourceId, p.basis]));
  assert.equal(basis.longba01, 'birthDate');
  assert.equal(basis.holdebi01, 'gpPattern+birthDateMissing');
  assert.equal(basis.grattje01, 'gpPattern+birthDateDiffers');
  assert.equal(basis.sjobela01, 'birthDate');
  assert.equal(auto.length, 6);
  assert.equal(review.length, 0);
});

test('matchSources never matches on surname + first name alone', () => {
  const { auto, review } = matchSources(
    [src('a', 'Gary Smith', '1944-02-04', [['1978-79', 11, 10]])],
    [src('1', 'Gary Smith', '1950-01-01', [['1972-73', 5, 0]])],
  );
  assert.equal(auto.length, 0);
  assert.equal(review.length, 1);
  assert.equal(review[0].id, 'hrdb:hr:a:db:1');
  assert.match(review[0].reason, /same surname only/);
});

test('pairDisagreements reports birth date, GP and totals; DB generic F is not a disagreement', () => {
  const h = src('x', 'Bob Ash', '1943-09-29', [['1972-73', 76, 13]], { position: 'C', positionNhlStyle: 'C' });
  const d = src('1', 'Bob Ash', '1943-09-30', [['1972-73', 76, 12]], { position: 'F', positionNhlStyle: null });
  const { disagreements, missing } = pairDisagreements(h, d);
  assert.deepEqual(disagreements.birthDate, { hr: '1943-09-29', db: '1943-09-30' });
  assert.deepEqual(disagreements.seasons, [{ season: '1972-73', hr: { regularGP: 76, playoffGP: 13 }, db: { regularGP: 76, playoffGP: 12 } }]);
  assert.ok(disagreements.totals);
  assert.equal(disagreements.position, undefined);
  assert.equal(missing[0].field, 'position');
});

// ---------------------------------------------------------------- ids

test('assignWhaIds: sorted, append-only, stable across re-runs, never reuses', () => {
  const c = (key, lastName, firstName, birthDate) => ({ key, lastName, firstName, birthDate, name: `${lastName}, ${firstName}` });
  const first = assignWhaIds([], [c('hr:z', 'Zanussi', 'Joe', '1947-09-25'), c('hr:a', 'Ash', 'Bob', '1943-09-29'), c('hr:s', 'Sjöberg', 'Lars', '1944-04-05')]);
  assert.deepEqual(first.added.map((a) => [a.key, a.playerId]), [['hr:a', WHA_ID_START], ['hr:s', WHA_ID_START + 1], ['hr:z', WHA_ID_START + 2]]);
  // Re-run with the same players: nothing new, same ids.
  const again = assignWhaIds(first.assignments, [c('hr:s', 'Sjöberg', 'Lars', '1944-04-05'), c('hr:a', 'Ash', 'Bob', '1943-09-29'), c('hr:z', 'Zanussi', 'Joe', '1947-09-25')]);
  assert.equal(again.added.length, 0);
  assert.deepEqual(again.assignments, first.assignments);
  // A newcomer that sorts first is appended after the highest id; nothing is renumbered,
  // and a player that dropped out keeps their id reserved.
  const later = assignWhaIds(first.assignments, [c('hr:aa', 'Aaron', 'Al', null), c('hr:a', 'Ash', 'Bob', '1943-09-29')]);
  assert.deepEqual(later.added.map((a) => [a.key, a.playerId]), [['hr:aa', WHA_ID_START + 3]]);
  assert.equal(later.idFor('hr:z'), WHA_ID_START + 2);
  assert.equal(later.idFor('hr:a'), WHA_ID_START);
});

// ---------------------------------------------------------------- decisions

test('indexDecisions validates shape', () => {
  assert.throws(() => indexDecisions({}), /expected \{ decisions/);
  assert.throws(() => indexDecisions({ decisions: [{ id: 'a', resolution: 'maybe' }] }), /resolution must be one of/);
  assert.throws(() => indexDecisions({ decisions: [{ id: 'a', resolution: 'same-person' }, { id: 'a', resolution: 'same-person' }] }), /duplicate/);
  assert.throws(() => indexDecisions({ decisions: [{ id: 'a', resolution: 'custom' }] }), /needs a value/);
  assert.equal(indexDecisions({ decisions: [{ id: 'a', resolution: 'same-person', note: 'x' }] }).size, 1);
});

test('resolveItem rejects resolutions that do not fit the item, tracks use, reports stale ids', () => {
  const decisions = indexDecisions({ decisions: [
    { id: 'nhl:hr:x:1', resolution: 'use-db' },
    { id: 'birthdate:hr:y', resolution: 'custom', value: '1950-01-01' },
    { id: 'gone', resolution: 'same-person' },
  ] });
  const used = new Set();
  assert.throws(() => resolveItem({ id: 'nhl:hr:x:1', kind: 'nhl', resolutions: ['same-person', 'different-person'] }, decisions, used), /not valid here/);
  const d = resolveItem({ id: 'birthdate:hr:y', kind: 'birthdate', resolutions: ['use-hr', 'use-db', 'custom'] }, decisions, used);
  assert.equal(d.value, '1950-01-01');
  assert.equal(resolveItem({ id: 'other', kind: 'nhl', resolutions: [] }, decisions, used), null);
  assert.deepEqual(staleDecisionWarnings(decisions, used).length, 2);
});

// ---------------------------------------------------------------- end to end

test('reconcile: tier A auto, tier B to review, tier C informational, birth date conflict to review', () => {
  const { report, idsChanged } = run();
  const m = Object.fromEntries(report.merge.map((x) => [x.key, x]));
  assert.equal(m['hr:lesukbi01'].action, 'extend-nhl');
  assert.equal(m['hr:lesukbi01'].playerId, 8448804);
  assert.equal(m['hr:sjobela01'].playerId, 8451388);
  assert.equal(m['hr:longba01'].action, 'pending-review');
  assert.equal(m['hr:longba01'].playerId, null);
  assert.equal(m['hr:holdebi01'].action, 'new-wha-only');
  assert.deepEqual(report.reviewItems.map((i) => i.id).sort(), ['birthdate:hr:grattje01', 'gp:hr:ashbo01:1972-73', 'nhl:hr:longba01:8448876']);
  assert.equal(report.nhlMatching.sameSurnameCollisions.length, 1); // Bill vs Mark Holden
  assert.equal(report.stats.nhlTierA, 2);
  assert.equal(report.stats.nhlTierB, 1);
  assert.ok(idsChanged);
  // ids: 3 WHA-only (Ash, Gratton, Holden) in sorted order; Long is pending so gets none yet.
  assert.deepEqual(report.ids.added.map((a) => a.key), ['hr:ashbo01', 'hr:grattje01', 'hr:holdebi01']);
  assert.deepEqual(report.positions.whaVsNhl.map((p) => p.name), ['Bill Lesuk']);
  assert.match(renderReview(report), /"id":"nhl:hr:longba01:8448876","resolution":"same-person"/);
});

test('reconcile: decisions resolve items, flow into the merge preview and warn when stale', () => {
  const first = run();
  const { report, idsChanged, warnings } = run([
    { id: 'nhl:hr:longba01:8448876', resolution: 'same-person', note: 'typo in NHL data' },
    { id: 'birthdate:hr:grattje01', resolution: 'use-db', note: '' },
    { id: 'gp:hr:ashbo01:1972-73', resolution: 'custom', value: { regularGP: 76, playoffGP: 12 } },
    { id: 'nhl:hr:nobody:1', resolution: 'different-person', note: '' },
  ], first.idsFile);
  assert.equal(report.reviewItems.length, 0);
  assert.equal(report.resolvedItems.length, 3);
  const m = Object.fromEntries(report.merge.map((x) => [x.key, x]));
  assert.equal(m['hr:longba01'].playerId, 8448876);
  assert.equal(m['hr:longba01'].birthDate.value, '1949-01-03'); // HR + DB agree over NHL
  assert.equal(m['hr:longba01'].changesCuratedBirthDate, true);
  assert.equal(m['hr:grattje01'].record.birthDate, '1949-03-08');
  assert.equal(m['hr:grattje01'].record.playerId, first.report.merge.find((x) => x.key === 'hr:grattje01').playerId);
  assert.deepEqual(m['hr:ashbo01'].record.wha.seasons, [{ season: '1972-73', regularGP: 76, playoffGP: 12 }]);
  assert.equal(idsChanged, false);
  assert.ok(warnings.some((w) => /nhl:hr:nobody:1/.test(w)));
});

test('reconcile: different-person sends a tier B player to the reserved range after existing ids', () => {
  const first = run();
  const { report } = run([{ id: 'nhl:hr:longba01:8448876', resolution: 'different-person', note: '' }], first.idsFile);
  const long = report.merge.find((x) => x.key === 'hr:longba01');
  assert.equal(long.action, 'new-wha-only');
  assert.equal(long.playerId, WHA_ID_START + 3);
});

test('reconcile is deterministic', () => {
  assert.deepEqual(run().report, run().report);
});

test('reconcile fails loudly on malformed inputs', () => {
  const bad = structuredClone(HR);
  bad.players[0].totals.regularGP += 1;
  assert.throws(() => reconcile({ hr: bad, db: DB, nhl: NHL, decisions: { decisions: [] }, ids: emptyIds() }), /totals/);
  const badDate = structuredClone(DB);
  badDate.players[0].birthDate = 'Jan 3 1949';
  assert.throws(() => reconcile({ hr: HR, db: badDate, nhl: NHL, decisions: { decisions: [] }, ids: emptyIds() }), /birthDate/);
  assert.throws(() => reconcile({ hr: HR, db: DB, nhl: {}, decisions: { decisions: [] }, ids: emptyIds() }), /array/);
  assert.throws(() => reconcile({ hr: HR, db: DB, nhl: NHL, decisions: { decisions: [] }, ids: { assignments: [{ key: 'a', playerId: 5 }] } }), /playerId/);
  assert.throws(() => run([{ id: 'nhl:hr:longba01:8448876', resolution: 'use-hr' }]), /not valid here/);
});

// ---------------------------------------------------------------- schema v2 / merged players.json

test('nhlLayer drops WHA-only records, reads v1 jets or v2 nhl, and prefers nhl.com birth dates', () => {
  const v2 = { ...nhlP(8448876, 'Barry', 'Long', '1949-01-03'), nhl: { regularGP: 10, playoffGP: 0, seasons: [] } };
  delete v2.jets;
  const whaOnly = { ...nhlP(900001, 'Bob', 'Ash', '1943-09-29'), playerId: 900001 };
  const layer = nhlLayer([v2, whaOnly, nhlP(1, 'Bill', 'Lesuk', '1946-11-01')], new Map([[8448876, '1949-01-31']]));
  assert.deepEqual(layer.map((p) => p.playerId), [8448876, 1]);
  assert.equal(layer[0].birthDate, '1949-01-31');
  assert.equal(layer[0].curatedBirthDate, '1949-01-03');
  assert.equal(layer[1].nhl.regularGP, 10); // v1 jets exposed as nhl
  assert.ok(isWhaReservedId(900000) && isWhaReservedId(900074) && !isWhaReservedId(8448876));
});

test('merge preview uses schema v2 records, notes and needsReview', () => {
  const first = run();
  const { report } = run([{ id: 'nhl:hr:longba01:8448876', resolution: 'same-person', note: 'Wikipedia: born 1949-01-03' }], first.idsFile);
  const m = Object.fromEntries(report.merge.map((x) => [x.key, x]));
  const holden = m['hr:holdebi01'].record;
  assert.deepEqual(holden.nhl, { regularGP: 0, playoffGP: 0, seasons: [] });
  assert.equal(holden.jets, undefined);
  assert.equal(holden.wha.position, undefined);
  assert.deepEqual(holden.wha.source.sites, ['hockey-reference.com', 'hockeydb.com']);
  assert.equal(holden.wha.source.definitive, false);
  assert.equal(holden.source.site, 'hockey-reference.com');
  assert.equal(holden.source.crossCheck, 'hockeydb.com');
  assert.deepEqual(holden.positions, ['G']);
  assert.deepEqual(holden.notes, ['birthDate 1949-07-23 per Hockey-Reference only; hockeydb has none', 'position per Hockey-Reference G; hockeydb has D',
    'rookieSeason 1972-73: first WHA Jets regular season (no Hockey-Reference career table available) (no NHL career)']);
  assert.equal(holden.rookieSeason, '1972-73');
  // Open birth-date item -> provisional note + needsReview
  assert.deepEqual(m['hr:grattje01'].record.needsReview, ['birthDate']);
  assert.match(m['hr:grattje01'].record.notes[0], /^birthDate provisional \(birthdate:hr:grattje01\): Hockey-Reference 1947-03-08, hockeydb 1949-03-08/);
  // Open GP item -> needsReview wha
  assert.deepEqual(m['hr:ashbo01'].record.needsReview, ['wha']);
  // Matched by decision with an NHL birth date typo: correction + decision notes
  const long = m['hr:longba01'];
  assert.equal(long.differsFromNhlCom, true);
  assert.deepEqual(long.needsReview, []);
  assert.ok(long.notes.includes('birthDate corrected 1949-01-31 -> 1949-01-03 (nhl.com value replaced): Hockey-Reference and hockeydb agree'));
  assert.ok(long.notes.some((n) => /owner decision nhl:hr:longba01:8448876: Wikipedia/.test(n)));
  // WHA position differing from NHL goes to notes (positions untouched)
  assert.deepEqual(m['hr:lesukbi01'].notes, ['WHA position per Hockey-Reference L (LW), hockeydb D; NHL positions R kept']);
});

test('reconcile on a merged players.json keeps matches and decisions stable (nhl.com birth dates)', () => {
  const first = run();
  const decisions = [{ id: 'nhl:hr:longba01:8448876', resolution: 'same-person', note: '' }];
  const before = run(decisions, first.idsFile).report;
  // players.json after a merge: corrected birth date, v2 block, plus a WHA-only record.
  const merged = structuredClone(NHL).map((p) => {
    const { jets, ...rest } = p;
    return { ...rest, nhl: jets, ...(p.playerId === 8448876 ? { birthDate: '1949-01-03' } : {}) };
  });
  merged.push({ ...nhlP(900003, 'Bill', 'Holden', '1949-07-23'), playerId: 900003 });
  const after = reconcile({
    hr: structuredClone(HR), db: structuredClone(DB), nhl: merged, decisions: { decisions }, ids: first.idsFile,
    nhlBirthDates: new Map(NHL.map((p) => [p.playerId, p.birthDate])),
  });
  assert.deepEqual(after.report.warnings, before.warnings); // decision not stale
  assert.ok(!after.report.warnings.some((w) => /stale/.test(w)));
  assert.deepEqual(after.report.resolvedItems.map((r) => r.id), before.resolvedItems.map((r) => r.id));
  assert.equal(after.report.merge.find((x) => x.key === 'hr:longba01').notes.join('|'), before.merge.find((x) => x.key === 'hr:longba01').notes.join('|'));
  assert.equal(after.report.merge.find((x) => x.key === 'hr:longba01').changesCuratedBirthDate, false);
});
