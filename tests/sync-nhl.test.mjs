import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncNhl, runSync, recentSeasons, referenceAgeProblem, normaliseName, indexDecisions, formatReport } from '../scripts/sync-nhl-players.mjs';
import { curatedPlayer } from '../scripts/init-curated-players.mjs';
import { validatePlayers } from '../scripts/validate.mjs';
import { comparePlayers } from '../scripts/wha/merge-wha-into-players.mjs';

// ---------------------------------------------------------------- fixtures

const GENERATED = '2026-10-17T20:00:00.000Z';
const NOW = new Date('2026-10-17T21:00:00.000Z');

/** A temp/reference/nhl-jets.json player. rows: [season, team, regularGP, playoffGP, position]. */
function refPlayer(playerId, firstName, lastName, birthDate, rows, extra = {}) {
  const seasons = rows.map(([season, team, regularGP, playoffGP, position = 'C']) => ({ season, team, regularGP, playoffGP, position }));
  return {
    playerId, name: `${firstName} ${lastName}`, firstName, lastName, country: 'CAN', birthDate,
    positions: [...new Set(seasons.map((s) => s.position))], rookieSeason: seasons[0]?.season ?? null,
    seasons, draft: null, source: { site: 'nhl.com', endpoints: [] }, qualifiedBy: seasons.length ? ['played'] : ['drafted'],
    ...extra,
  };
}
const DRAFT = { year: 2025, team: 'WPG', round: 1, overall: 28, amateurTeam: 'Kitchener', amateurLeague: 'OHL' };

function reference(players, generatedAt = GENERATED) {
  return { generatedAt, sourceNotes: 'test', players };
}

// Reference as it was when players.json was seeded; then a later pull with changes.
const SCHEIFELE = refPlayer(8476460, 'Mark', 'Scheifele', '1993-03-15', [['2011-12', 'WPG', 7, 0], ['2024-25', 'WPG', 82, 11], ['2025-26', 'WPG', 80, 4], ['2026-27', 'WPG', 3, 0]], { rookieSeason: '2011-12' });
const HAWERCHUK = refPlayer(8448091, 'Dale', 'Hawerchuk', '1963-04-04', [['1981-82', 'WIN', 80, 4], ['1982-83', 'WIN', 79, 3]], { rookieSeason: '1981-82' });
const PROSPECT = refPlayer(8485000, 'Pat', 'Prospect', '2007-01-01', [], { draft: DRAFT, qualifiedBy: ['drafted'] });
const BASE_REF = reference([SCHEIFELE, HAWERCHUK, PROSPECT]);

const seed = (ref) => ref.players.map((p) => curatedPlayer(p, ref.generatedAt.slice(0, 10)));
const WHA_ONLY = {
  playerId: 900010, firstName: 'Bobby', lastName: 'Hullé', name: 'Hullé, Bobby', country: 'CAN', birthDate: '1939-01-03',
  positions: ['L'], rookieSeason: '1972-73', nhl: { regularGP: 0, playoffGP: 0, seasons: [] },
  wha: { regularGP: 1, playoffGP: 0, seasons: [{ season: '1972-73', regularGP: 1, playoffGP: 0 }], source: { sites: ['hockey-reference.com'], definitive: false, retrieved: '2026-10-17' } },
  draft: null, qualifiedBy: ['played'], source: { site: 'hockey-reference.com', definitive: false, retrieved: '2026-10-17' }, notes: ['hand note'],
};
const CURATED = [...seed(BASE_REF), WHA_ONLY].sort(comparePlayers);

const clone = (x) => structuredClone(x);
/** Reference with one player replaced via fn(player) -> player. */
function edited(id, fn, base = BASE_REF) {
  const r = clone(base);
  r.players = r.players.map((p) => (p.playerId === id ? fn(clone(p)) : p));
  return r;
}
const find = (players, id) => players.find((p) => p.playerId === id);
const dec = (...decisions) => ({ decisions });

// ---------------------------------------------------------------- helpers

test('recentSeasons derives the two latest seasons from the data', () => {
  assert.deepEqual(recentSeasons(BASE_REF), ['2025-26', '2026-27']);
  assert.deepEqual(recentSeasons(reference([HAWERCHUK])), ['1981-82', '1982-83']);
});

test('normaliseName ignores case, accents and punctuation', () => {
  assert.equal(normaliseName("Hullé"), 'hulle');
  assert.equal(normaliseName("O'Reilly-Smith"), 'oreillysmith');
});

test('indexDecisions rejects malformed decisions', () => {
  assert.throws(() => indexDecisions(dec({ id: 'birthDate:1', resolution: 'accept', note: 'x' })), /bad decision id/);
  assert.throws(() => indexDecisions(dec({ id: 'field:1:birthDate', resolution: 'maybe', note: 'x' })), /resolution/);
  assert.throws(() => indexDecisions(dec({ id: 'field:1:birthDate', resolution: 'accept', note: '' })), /note/);
  assert.throws(() => indexDecisions(dec({ id: 'field:1:birthDate', resolution: 'accept', note: 'a' }, { id: 'field:1:birthDate', resolution: 'accept', note: 'b' })), /duplicate/);
});

// ---------------------------------------------------------------- rules

test('no differences: nothing changes', () => {
  const { players, report } = syncNhl(CURATED, BASE_REF);
  assert.deepEqual(players, CURATED);
  assert.equal(report.review.length + report.added.length + report.autoUpdated.length, 0);
  assert.equal(report.missingOther, 1); // the WHA-only player is not expected in the pull
});

test('ADD: a new player gets the full curated record shape and passes validation', () => {
  const debut = refPlayer(8486000, 'New', 'Callup', '2004-05-05', [['2026-27', 'WPG', 1, 0, 'D']], { rookieSeason: '2026-27' });
  const ref = reference([...BASE_REF.players, debut]);
  const { players, report } = syncNhl(CURATED, ref);
  const added = find(players, 8486000);
  assert.deepEqual(added, curatedPlayer(debut, '2026-10-17'));
  assert.deepEqual(added.source, { site: 'nhl.com', definitive: true, retrieved: '2026-10-17' });
  assert.equal(added.notes, undefined);
  assert.deepEqual(report.added.map((a) => a.playerId), [8486000]);
  assert.match(report.added[0].why, /played 2026-27 WPG/);
  assert.deepEqual(validatePlayers(players), []);
  assert.deepEqual(players.map((p) => p.lastName), ['Callup', 'Hawerchuk', 'Hullé', 'Prospect', 'Scheifele']);
});

test('CONFLICT: a new id matching an existing player by lastName + birthDate is not added', () => {
  const nhlHull = refPlayer(8447000, 'Bobby', 'Hulle', '1939-01-03', [['1979-80', 'WIN', 4, 0, 'L']]);
  const ref = reference([...BASE_REF.players, nhlHull]);
  const { players, report } = syncNhl(CURATED, ref);
  assert.equal(find(players, 8447000), undefined);
  assert.equal(players.length, CURATED.length);
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.conflicts[0].id, 'add:8447000');
  assert.deepEqual(report.conflicts[0].matches.map((m) => m.playerId), [900010]);

  // An owner decision can add anyway (different person) or keep it out permanently.
  const accepted = syncNhl(CURATED, ref, dec({ id: 'add:8447000', resolution: 'accept', note: 'different person' }));
  assert.ok(find(accepted.players, 8447000));
  assert.equal(accepted.report.conflicts.length, 0);
  const kept = syncNhl(CURATED, ref, dec({ id: 'add:8447000', resolution: 'keep-curated', note: 'same person' }));
  assert.equal(find(kept.players, 8447000), undefined);
  assert.equal(kept.report.conflicts.length, 0);
  assert.equal(kept.report.overrides.length, 1);
});

test('AUTO: recent two seasons and totals refresh; everything else untouched', () => {
  const ref = edited(8476460, (p) => {
    p.seasons.find((s) => s.season === '2026-27').regularGP = 6;
    p.seasons.find((s) => s.season === '2025-26').playoffGP = 5;
    return p;
  });
  const curated = clone(CURATED);
  find(curated, 8476460).notes = ['kept'];
  find(curated, 8476460).needsReview = ['birthDate'];
  const { players, report } = syncNhl(curated, ref);
  const s = find(players, 8476460);
  assert.equal(s.nhl.seasons.find((x) => x.season === '2026-27').regularGP, 6);
  assert.equal(s.nhl.regularGP, 7 + 82 + 80 + 6);
  assert.equal(s.nhl.playoffGP, 11 + 5);
  assert.deepEqual(s.notes, ['kept']);
  assert.deepEqual(s.needsReview, ['birthDate']);
  assert.deepEqual({ ...s, nhl: null }, { ...find(curated, 8476460), nhl: null });
  assert.equal(report.autoUpdated.length, 1);
  assert.equal(report.review.length, 0);
  assert.deepEqual(validatePlayers(players), []);
});

test('AUTO: drafted-only player first plays -> season added and qualifiedBy gains "played"', () => {
  const ref = edited(8485000, (p) => ({ ...p, positions: ['D'], rookieSeason: '2026-27', qualifiedBy: ['played', 'drafted'], seasons: [{ season: '2026-27', team: 'WPG', regularGP: 1, playoffGP: 0, position: 'D' }] }));
  const { players, report } = syncNhl(CURATED, ref);
  const p = find(players, 8485000);
  assert.deepEqual(p.qualifiedBy, ['played', 'drafted']);
  assert.equal(p.nhl.regularGP, 1);
  // rookieSeason null -> nhl.com is filled with the first game (a player with games needs one)
  assert.equal(p.rookieSeason, '2026-27');
  // positions are review items, never auto-applied
  assert.deepEqual(p.positions, []);
  assert.deepEqual(report.review.map((r) => r.id), ['field:8485000:positions']);
  assert.deepEqual(validatePlayers(players), []);
  // --apply refuses while the positions item is open; --allow-open writes the safe parts
  const args = (extra) => ({ playersText: JSON.stringify(CURATED, null, 2) + '\n', referenceText: JSON.stringify(ref), now: NOW, ...extra });
  assert.equal(runSync(args({ decisionsJson: null, args: ['--apply'] })).code, 1);
  const partial = runSync(args({ decisionsJson: null, args: ['--apply', '--allow-open'] }));
  assert.equal(partial.code, 0);
  assert.deepEqual(find(JSON.parse(partial.write), 8485000).qualifiedBy, ['played', 'drafted']);
  // once accepted, positions follow
  const ok = runSync(args({ args: ['--apply'], decisionsJson: dec({ id: 'field:8485000:positions', resolution: 'accept', note: 'debut', value: ['D'] }) }));
  assert.equal(ok.code, 0);
  assert.deepEqual(find(JSON.parse(ok.write), 8485000).positions, ['D']);
});

test('REVIEW: a change to an older season is listed, not applied; accept applies it with totals', () => {
  const ref = edited(8448091, (p) => { p.seasons[0].regularGP = 81; return p; });
  const { players, report } = syncNhl(CURATED, ref);
  assert.deepEqual(find(players, 8448091), find(CURATED, 8448091));
  assert.deepEqual(report.review.map((r) => r.id), ['season:8448091:1981-82:WIN']);
  assert.match(formatReport(report).join('\n'), /80 GP \/ 4 playoff GP -> 81 GP \/ 4 playoff GP/);

  const accepted = syncNhl(CURATED, ref, dec({ id: 'season:8448091:1981-82:WIN', resolution: 'accept', note: 'nhl.com fix' }));
  assert.equal(find(accepted.players, 8448091).nhl.regularGP, 81 + 79);
  assert.equal(accepted.report.review.length, 0);
  assert.deepEqual(validatePlayers(accepted.players), []);
});

test('REVIEW: identity changes are listed, never applied; accepting a name re-derives name', () => {
  const ref = edited(8476460, (p) => ({ ...p, firstName: 'Marc', birthDate: '1993-03-16', country: 'USA', draft: DRAFT, qualifiedBy: ['played', 'drafted'] }));
  const { players, report } = syncNhl(CURATED, ref);
  assert.deepEqual(find(players, 8476460), find(CURATED, 8476460));
  assert.deepEqual(report.review.map((r) => r.id).sort(), ['field:8476460:birthDate', 'field:8476460:country', 'field:8476460:draft', 'field:8476460:firstName', 'field:8476460:qualifiedBy.drafted'].sort());

  const accepted = syncNhl(CURATED, ref, dec({ id: 'field:8476460:firstName', resolution: 'accept', note: 'ok' }));
  const p = find(accepted.players, 8476460);
  assert.equal(p.firstName, 'Marc');
  assert.equal(p.name, 'Scheifele, Marc');
  assert.equal(p.birthDate, '1993-03-15');
});

test('keep-curated override is stable across runs, and reopens if nhl.com changes again', () => {
  const ref = edited(8448091, (p) => ({ ...p, birthDate: '1963-04-14' }));
  const decisions = dec({ id: 'field:8448091:birthDate', resolution: 'keep-curated', note: 'cards say 04-04', value: '1963-04-14' });
  const first = syncNhl(CURATED, ref, decisions);
  const second = syncNhl(first.players, ref, decisions);
  for (const run of [first, second]) {
    assert.equal(find(run.players, 8448091).birthDate, '1963-04-04');
    assert.equal(run.report.review.length, 0);
    assert.deepEqual(run.report.overrides.map((o) => o.id), ['field:8448091:birthDate']);
    assert.deepEqual(run.report.stale, []);
  }
  const ref2 = edited(8448091, (p) => ({ ...p, birthDate: '1963-05-04' }));
  const reopened = syncNhl(CURATED, ref2, decisions);
  assert.deepEqual(reopened.report.review.map((r) => r.id), ['field:8448091:birthDate']);
  assert.equal(reopened.report.reopened.length, 1);
});

test('stale and dormant decisions are reported', () => {
  const { report } = syncNhl(CURATED, BASE_REF, dec(
    { id: 'field:8448091:birthDate', resolution: 'keep-curated', note: 'x' },
    { id: 'field:900010:birthDate', resolution: 'keep-curated', note: 'not in pull' },
    { id: 'field:1:country', resolution: 'accept', note: 'nobody' },
  ));
  assert.equal(report.stale.length, 2);
  assert.deepEqual(report.dormant.map((d) => d.id), ['field:900010:birthDate']);
});

test('never deletes: an nhl.com player missing from the pull is only reported', () => {
  const ref = reference(BASE_REF.players.filter((p) => p.playerId !== 8448091));
  const { players, report } = syncNhl(CURATED, ref);
  assert.deepEqual(find(players, 8448091), find(CURATED, 8448091));
  assert.deepEqual(report.missing.map((m) => m.playerId), [8448091]);
});

test('positions differences are review items even for old players', () => {
  const ref = edited(8448091, (p) => ({ ...p, positions: ['C', 'L'] }));
  const { players, report } = syncNhl(CURATED, ref);
  assert.deepEqual(find(players, 8448091).positions, ['C']);
  assert.deepEqual(report.review.map((r) => r.id), ['field:8448091:positions']);
});

// ---------------------------------------------------------------- command

const text = (players) => JSON.stringify(players, null, 2) + '\n';
const run = (over = {}) => runSync({ playersText: text(CURATED), referenceText: JSON.stringify(BASE_REF), decisionsJson: null, now: NOW, args: [], ...over });

test('idempotent: applying twice changes nothing the second time', () => {
  const debut = refPlayer(8486000, 'New', 'Callup', '2004-05-05', [['2026-27', 'WPG', 1, 0, 'D']], { rookieSeason: '2026-27' });
  const ref = edited(8476460, (p) => { p.seasons.at(-1).regularGP = 9; return p; }, reference([...BASE_REF.players, debut]));
  const first = run({ referenceText: JSON.stringify(ref), args: ['--apply'] });
  assert.equal(first.code, 0);
  assert.ok(first.write);
  const second = run({ playersText: first.write, referenceText: JSON.stringify(ref), args: ['--apply'] });
  assert.equal(second.code, 0);
  assert.equal(second.write, null);
  assert.ok(second.out.includes('No changes.'));
});

test('dry run never writes', () => {
  const ref = edited(8476460, (p) => { p.seasons.at(-1).regularGP = 9; return p; });
  const r = run({ referenceText: JSON.stringify(ref) });
  assert.equal(r.code, 0);
  assert.equal(r.write, null);
});

test('--apply refuses while review items are open; --allow-open writes only the safe parts', () => {
  const ref = edited(8476460, (p) => { p.seasons.at(-1).regularGP = 9; p.birthDate = '1993-03-16'; return p; });
  const refused = run({ referenceText: JSON.stringify(ref), args: ['--apply'] });
  assert.equal(refused.code, 1);
  assert.equal(refused.write, null);
  const partial = run({ referenceText: JSON.stringify(ref), args: ['--apply', '--allow-open'] });
  assert.equal(partial.code, 0);
  const p = find(JSON.parse(partial.write), 8476460);
  assert.equal(p.nhl.seasons.at(-1).regularGP, 9);
  assert.equal(p.birthDate, '1993-03-15');
});

test('refuses to write an invalid result', () => {
  // A new player whose nhl.com record has duplicate season rows would produce an invalid file.
  const bad = refPlayer(8486001, 'Bad', 'Data', '2003-03-03', [['2026-27', 'WPG', 1, 0], ['2026-27', 'WPG', 1, 0]], { rookieSeason: '2026-27' });
  const r = run({ referenceText: JSON.stringify(reference([...BASE_REF.players, bad])), args: ['--apply', '--allow-open'] });
  assert.equal(r.code, 1);
  assert.equal(r.write, null);
  assert.ok(r.err.some((e) => /duplicate season row/.test(e)));
});

test('stale or missing reference is refused unless --allow-stale', () => {
  const old = reference(BASE_REF.players, '2026-10-15T00:00:00.000Z');
  assert.match(referenceAgeProblem(old, NOW), /h old/);
  assert.equal(referenceAgeProblem(BASE_REF, NOW), null);
  const refused = run({ referenceText: JSON.stringify(old) });
  assert.equal(refused.code, 1);
  assert.match(refused.err[0], /--allow-stale/);
  const allowed = run({ referenceText: JSON.stringify(old), args: ['--allow-stale'] });
  assert.equal(allowed.code, 0);
  const missing = run({ referenceText: null });
  assert.equal(missing.code, 1);
  assert.match(missing.err[0], /get:nhl/);
});

test('unknown options are rejected', () => {
  assert.equal(run({ args: ['--force'] }).code, 2);
});
