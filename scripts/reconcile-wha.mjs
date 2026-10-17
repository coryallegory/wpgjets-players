#!/usr/bin/env node
// Reconciles the WHA Winnipeg Jets reference pulls with each other and with the curated NHL layer.
// Network-free and deterministic; never writes curated data.
//
// Inputs (read-only):
//   temp/reference/hockeyreference-wha-jets.json  (HR, primary)
//   temp/reference/hockeydb-wha-jets.json         (DB, cross-check)
//   site/data/curated/players.json                (NHL layer)
//   data/decisions/wha-decisions.json             (owner resolutions of review items)
//   temp/cache/hockeyreference/team_WNJ_*.html    (optional: per-season HR positions)
// Outputs:
//   temp/reference/wha-reconcile.json  machine report (matches, disagreements, review, merge preview)
//   temp/reference/wha-review.md       human review list with paste-ready decision snippets
//   data/decisions/wha-ids.json        reserved-range playerIds for WHA-only players (append-only)
//
// Usage: npm run reconcile:wha
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PATHS = {
  hr: resolve(ROOT, 'temp', 'reference', 'hockeyreference-wha-jets.json'),
  db: resolve(ROOT, 'temp', 'reference', 'hockeydb-wha-jets.json'),
  nhl: resolve(ROOT, 'site', 'data', 'curated', 'players.json'),
  decisions: resolve(ROOT, 'data', 'decisions', 'wha-decisions.json'),
  ids: resolve(ROOT, 'data', 'decisions', 'wha-ids.json'),
  hrCache: resolve(ROOT, 'temp', 'cache', 'hockeyreference'),
  report: resolve(ROOT, 'temp', 'reference', 'wha-reconcile.json'),
  review: resolve(ROOT, 'temp', 'reference', 'wha-review.md'),
};
const HR_END_YEARS = [1973, 1974, 1975, 1976, 1977, 1978, 1979];

export const WHA_ID_START = 900001;
export const RESOLUTIONS = ['same-person', 'different-person', 'use-hr', 'use-db', 'use-nhl', 'custom'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SEASON = /^\d{4}-\d{2}$/;
const SOURCE_LABEL = { hr: 'Hockey-Reference', db: 'hockeydb', nhl: 'NHL layer' };

// ---------------------------------------------------------------- names

// Letters that NFD does not decompose into base + combining mark.
const SPECIAL_LETTERS = { ø: 'o', Ø: 'o', æ: 'ae', Æ: 'ae', œ: 'oe', Œ: 'oe', ß: 'ss', ł: 'l', Ł: 'l', đ: 'd', ð: 'd', þ: 'th' };

/** "Sjöberg" -> "sjoberg", "Jean-Guy" -> "jeanguy", "Mac Kinnon" -> "mackinnon". */
export function normName(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/[øØæÆœŒßłŁđðþ]/g, (c) => SPECIAL_LETTERS[c])
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

// First-name equivalence groups. Only ever used to CONFIRM a candidate that already agrees on
// birth date or GP pattern, never as the sole basis for a match.
const NICKNAME_GROUPS = [
  ['bob', 'bobby', 'rob', 'robbie', 'robby', 'robert', 'robin'],
  ['dan', 'danny', 'daniel'],
  ['chris', 'christian', 'christopher', 'kris'],
  ['bill', 'billy', 'will', 'willy', 'willie', 'william', 'liam'],
  ['jim', 'jimmy', 'jamie', 'james'],
  ['doug', 'douglas'],
  ['ted', 'teddy', 'ed', 'eddie', 'eddy', 'edward', 'ned', 'theodore'],
  ['mike', 'mikey', 'mickey', 'michael', 'mick'],
  ['tom', 'tommy', 'thomas'],
  ['ken', 'kenny', 'kenneth'],
  ['gord', 'gordie', 'gordy', 'gordon'],
  ['lars-erik', 'lars'],
  ['duke', 'freeman'],
  ['dave', 'davey', 'david'],
  ['steve', 'stevie', 'steven', 'stephen'],
  ['rich', 'richie', 'rick', 'ricky', 'dick', 'richard', 'richmond'],
  ['ron', 'ronnie', 'ronald'],
  ['larry', 'lawrence', 'laurence'],
  ['norm', 'norman'],
  ['walt', 'wally', 'walter'],
  ['al', 'alan', 'allan', 'allen', 'alvin', 'ab', 'albert'],
  ['joe', 'joey', 'joseph'],
  ['jerry', 'gerry', 'gerald', 'gerard'],
  ['fran', 'frank', 'francis'],
  ['ernie', 'ernest'],
  ['howie', 'howard'],
  ['cal', 'calvin'],
  ['dunc', 'duncan'],
  ['milt', 'milton'],
  ['kim', 'kimble'],
  ['randy', 'randall', 'randolph'],
  ['pete', 'peter'],
  ['pat', 'patrick', 'paddy'],
  ['matt', 'matthew'],
  ['nick', 'nicholas', 'nicolas'],
  ['tony', 'anthony'],
  ['andy', 'andrew'],
  ['alex', 'alexander', 'alec', 'sandy'],
  ['fred', 'freddie', 'freddy', 'frederick'],
  ['ray', 'raymond'],
  ['jack', 'john', 'johnny', 'jon'],
  ['don', 'donnie', 'donald'],
  ['greg', 'gregory'],
  ['jeff', 'jeffrey', 'geoff', 'geoffrey'],
  ['tim', 'timmy', 'timothy'],
  ['vic', 'victor'],
  ['phil', 'phillip', 'philip'],
  ['sam', 'samuel', 'sammy'],
  ['ben', 'benjamin', 'benny'],
  ['charlie', 'chuck', 'charles'],
  ['hank', 'henry', 'harry'],
  ['len', 'lenny', 'leonard'],
  ['russ', 'russell'],
  ['terry', 'terrence', 'terence'],
  ['gus', 'august', 'augie'],
  ['jean-guy', 'jean'],
  ['veli-pekka', 'veli'],
];
const GROUPS_BY_NAME = new Map();
NICKNAME_GROUPS.forEach((group, i) => {
  for (const n of group) {
    const k = normName(n);
    GROUPS_BY_NAME.set(k, [...(GROUPS_BY_NAME.get(k) ?? []), i]);
  }
});

/** True when two single first names are equal after normalisation or share a nickname group. */
export function firstNamesCompatible(a, b) {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const gx = GROUPS_BY_NAME.get(x) ?? [];
  const gy = GROUPS_BY_NAME.get(y) ?? [];
  return gx.some((g) => gy.includes(g));
}

/** Every first-name form a record offers: firstName (+ its first hyphen/space part), given names
 *  from fullName, single-word nickname, and the first token of each alias. */
export function givenNameVariants(p) {
  const out = new Set();
  const add = (s) => { if (s && normName(s)) out.add(s); };
  add(p.firstName);
  add(String(p.firstName ?? '').split(/[-\s]/)[0]);
  const full = String(p.fullName ?? '').trim().split(/\s+/);
  for (const t of full.slice(0, -1)) add(t);
  if (p.nickname && !/\s|,/.test(p.nickname.trim())) add(p.nickname.trim());
  for (const a of p.aliases ?? []) add(String(a).split(/\s+/)[0]);
  return [...out];
}

export function namesCompatible(a, b) {
  const va = givenNameVariants(a);
  const vb = givenNameVariants(b);
  return va.some((x) => vb.some((y) => firstNamesCompatible(x, y)));
}

// ---------------------------------------------------------------- dates, GP

/** 'equal' | 'same-year' | 'different' | 'missing' */
export function compareBirthDates(a, b) {
  if (!a || !b) return 'missing';
  if (a === b) return 'equal';
  return a.slice(0, 4) === b.slice(0, 4) ? 'same-year' : 'different';
}

export const gpKey = (seasons) =>
  [...seasons].sort((a, b) => cmp(a.season, b.season)).map((s) => `${s.season}:${s.regularGP}/${s.playoffGP}`).join('|');

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sum = (rows, key) => rows.reduce((t, r) => t + r[key], 0);

/**
 * Proposed stored birth date: a value 2+ sources agree on; otherwise HR's (then NHL's, then DB's)
 * with conflict=true so a review item is raised.
 */
export function proposeBirthDate({ hr = null, db = null, nhl = null }) {
  const vals = Object.entries({ hr, db, nhl }).filter(([, v]) => v);
  const bySource = Object.fromEntries(vals);
  const counts = new Map();
  for (const [, v] of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  const distinct = [...counts.keys()];
  if (!vals.length) return { value: null, basis: 'none', conflict: true, sources: bySource };
  const majority = distinct.find((v) => counts.get(v) >= 2);
  if (majority) {
    return {
      value: majority,
      basis: distinct.length === 1 ? 'all-agree' : 'majority',
      agreeing: vals.filter(([, v]) => v === majority).map(([k]) => k),
      dissenting: vals.filter(([, v]) => v !== majority).map(([k]) => k),
      conflict: false,
      sources: bySource,
    };
  }
  if (distinct.length === 1) return { value: distinct[0], basis: 'single-source', conflict: false, sources: bySource };
  return { value: hr ?? nhl ?? db, basis: hr ? 'fallback-hr' : nhl ? 'fallback-nhl' : 'fallback-db', conflict: true, sources: bySource };
}

// ---------------------------------------------------------------- input validation

function fail(msg) {
  throw new Error(`reconcile-wha: ${msg}`);
}

export function validateSourceFile(json, label) {
  if (!json || !Array.isArray(json.players)) fail(`${label}: expected { players: [...] }`);
  const ids = new Set();
  for (const [i, p] of json.players.entries()) {
    const where = `${label} players[${i}]`;
    if (typeof p.sourceId !== 'string' || !p.sourceId) fail(`${where}: sourceId must be a non-empty string`);
    if (ids.has(p.sourceId)) fail(`${where}: duplicate sourceId ${p.sourceId}`);
    ids.add(p.sourceId);
    for (const k of ['name', 'lastName']) if (typeof p[k] !== 'string' || !p[k]) fail(`${where} (${p.sourceId}): ${k} must be a non-empty string`);
    if (typeof p.firstName !== 'string') fail(`${where} (${p.sourceId}): firstName must be a string`);
    if (p.birthDate !== null && !ISO_DATE.test(p.birthDate ?? '')) fail(`${where} (${p.sourceId}): birthDate must be ISO or null`);
    if (!Array.isArray(p.seasons) || !p.seasons.length) fail(`${where} (${p.sourceId}): seasons must be a non-empty array`);
    for (const s of p.seasons) {
      if (!SEASON.test(s.season ?? '')) fail(`${where} (${p.sourceId}): bad season label ${JSON.stringify(s.season)}`);
      for (const k of ['regularGP', 'playoffGP']) if (!Number.isInteger(s[k]) || s[k] < 0) fail(`${where} (${p.sourceId}) ${s.season}: ${k} must be an integer >= 0`);
    }
    if (new Set(p.seasons.map((s) => s.season)).size !== p.seasons.length) fail(`${where} (${p.sourceId}): duplicate season rows`);
    if (!p.totals || p.totals.regularGP !== sum(p.seasons, 'regularGP') || p.totals.playoffGP !== sum(p.seasons, 'playoffGP')) {
      fail(`${where} (${p.sourceId}): totals do not equal the sum of seasons`);
    }
  }
  return json;
}

export function validateNhlPlayers(json) {
  if (!Array.isArray(json)) fail('players.json: expected an array');
  const ids = new Set();
  for (const [i, p] of json.entries()) {
    if (!Number.isInteger(p.playerId)) fail(`players.json[${i}]: playerId must be an integer`);
    if (ids.has(p.playerId)) fail(`players.json[${i}]: duplicate playerId ${p.playerId}`);
    ids.add(p.playerId);
    if (typeof p.lastName !== 'string' || !p.lastName) fail(`players.json[${i}] (${p.playerId}): lastName missing`);
    if (p.birthDate !== null && !ISO_DATE.test(p.birthDate ?? '')) fail(`players.json[${i}] (${p.playerId}): birthDate must be ISO or null`);
    if (p.playerId >= WHA_ID_START - 1 && p.playerId < 1000000) fail(`players.json[${i}]: playerId ${p.playerId} collides with the reserved WHA range`);
  }
  return json;
}

/** Validates the decisions file and indexes it by id. */
export function indexDecisions(json) {
  if (!json || !Array.isArray(json.decisions)) fail('wha-decisions.json: expected { decisions: [...] }');
  const byId = new Map();
  for (const [i, d] of json.decisions.entries()) {
    const where = `wha-decisions.json decisions[${i}]`;
    if (typeof d.id !== 'string' || !d.id) fail(`${where}: id must be a non-empty string`);
    if (byId.has(d.id)) fail(`${where}: duplicate decision id ${d.id}`);
    if (!RESOLUTIONS.includes(d.resolution)) fail(`${where} (${d.id}): resolution must be one of ${RESOLUTIONS.join(', ')}`);
    if (d.note !== undefined && typeof d.note !== 'string') fail(`${where} (${d.id}): note must be a string`);
    if (d.resolution === 'custom' && d.value === undefined) fail(`${where} (${d.id}): custom resolution needs a value`);
    byId.set(d.id, d);
  }
  return byId;
}

/**
 * Looks up the owner's decision for a review item and checks it is a valid resolution for that item
 * kind. Records the id as used so stale decisions can be reported afterwards.
 */
export function resolveItem(item, decisions, used) {
  const d = decisions.get(item.id);
  if (!d) return null;
  if (!item.resolutions.includes(d.resolution)) {
    fail(`decision ${d.id}: resolution "${d.resolution}" is not valid here (allowed: ${item.resolutions.join(', ')})`);
  }
  if (d.resolution === 'custom') {
    if (item.kind === 'birthdate' && !ISO_DATE.test(String(d.value))) fail(`decision ${d.id}: custom value must be an ISO date`);
    if (item.kind === 'gp' && !(Number.isInteger(d.value?.regularGP) && d.value.regularGP >= 0 && Number.isInteger(d.value?.playoffGP) && d.value.playoffGP >= 0)) {
      fail(`decision ${d.id}: custom value must be { regularGP, playoffGP } non-negative integers`);
    }
  }
  used.add(d.id);
  return d;
}

export function staleDecisionWarnings(decisions, used) {
  return [...decisions.keys()].filter((id) => !used.has(id)).map((id) => `decision "${id}" matches no current review item (unknown or stale id); ignored`);
}

// ---------------------------------------------------------------- id assignment

export function validateIdsFile(json) {
  if (!json || !Array.isArray(json.assignments)) fail('wha-ids.json: expected { assignments: [...] }');
  const keys = new Set();
  const ids = new Set();
  for (const [i, a] of json.assignments.entries()) {
    if (typeof a.key !== 'string' || !a.key) fail(`wha-ids.json assignments[${i}]: key must be a non-empty string`);
    if (!Number.isInteger(a.playerId) || a.playerId < WHA_ID_START) fail(`wha-ids.json assignments[${i}]: playerId must be an integer >= ${WHA_ID_START}`);
    if (keys.has(a.key)) fail(`wha-ids.json: duplicate key ${a.key}`);
    if (ids.has(a.playerId)) fail(`wha-ids.json: duplicate playerId ${a.playerId}`);
    keys.add(a.key);
    ids.add(a.playerId);
  }
  return json;
}

const sortKey = (c) => [normName(c.lastName), normName(c.firstName), c.birthDate ?? '', c.key];

/**
 * Append-only id assignment: existing assignments are kept untouched (never renumbered, never
 * reused even if the player later turns out to be in the NHL layer); new keys are sorted by
 * (lastName, firstName, birthDate) and numbered after the highest id ever issued.
 */
export function assignWhaIds(existing, candidates, start = WHA_ID_START) {
  const known = new Map(existing.map((a) => [a.key, a]));
  let next = Math.max(start - 1, ...existing.map((a) => a.playerId)) + 1;
  const fresh = candidates
    .filter((c) => !known.has(c.key))
    .sort((a, b) => {
      const ka = sortKey(a);
      const kb = sortKey(b);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return cmp(ka[i], kb[i]);
      return 0;
    });
  const added = fresh.map((c) => ({ key: c.key, playerId: next++, name: c.name, birthDate: c.birthDate ?? null }));
  const assignments = [...existing, ...added];
  const byKey = new Map(assignments.map((a) => [a.key, a.playerId]));
  return { assignments, added, idFor: (key) => byKey.get(key) ?? null };
}

// ---------------------------------------------------------------- evidence helpers

const seasonsText = (seasons) => seasons.map((s) => `${s.season} ${s.regularGP}/${s.playoffGP}`).join('; ');

function sideSummary(kind, p) {
  if (!p) return null;
  if (kind === 'nhl') {
    return {
      id: String(p.playerId), name: `${p.firstName} ${p.lastName}`, fullName: null, birthDate: p.birthDate,
      birthplace: null, country: p.country ?? null, position: (p.positions ?? []).join('/') || null,
      seasons: `${seasonsText(p.jets?.seasons ?? []) || '(no Jets GP)'}${p.rookieSeason ? `; NHL rookie ${p.rookieSeason}` : ''}`,
      totals: p.jets ? `${p.jets.regularGP}/${p.jets.playoffGP}` : null,
    };
  }
  return {
    id: p.sourceId, name: p.name, fullName: p.fullName ?? null, nickname: p.nickname ?? null, birthDate: p.birthDate,
    birthplace: p.birthplace ?? null, country: p.country ?? null,
    position: p.position ? `${p.position}${p.positionNhlStyle && p.positionNhlStyle !== p.position ? ` (${p.positionNhlStyle})` : ''}` : null,
    seasons: seasonsText(p.seasons), totals: `${p.totals.regularGP}/${p.totals.playoffGP}`,
  };
}

const evidence = ({ hr = null, db = null, nhl = null }) => ({ hr: sideSummary('hr', hr), db: sideSummary('db', db), nhl: sideSummary('nhl', nhl) });

// ---------------------------------------------------------------- 1. HR <-> DB

/**
 * Pairs HR and DB records. Basis: same normalised last name AND (equal birth date, OR identical
 * per-season GP pattern with a compatible first name). Ambiguous or name-inconsistent pairs become
 * review items; same-surname leftovers that are unmatched on both sides are offered for review too.
 */
export function matchSources(hrPlayers, dbPlayers) {
  const dbByLast = groupBy(dbPlayers, (d) => normName(d.lastName));
  const proposals = [];
  for (const h of hrPlayers) {
    for (const d of dbByLast.get(normName(h.lastName)) ?? []) {
      const birthRelation = compareBirthDates(h.birthDate, d.birthDate);
      const sameGp = gpKey(h.seasons) === gpKey(d.seasons);
      const namesOk = namesCompatible(h, d);
      let basis = null;
      if (birthRelation === 'equal') basis = 'birthDate';
      else if (sameGp && namesOk) basis = birthRelation === 'missing' ? 'gpPattern+birthDateMissing' : 'gpPattern+birthDateDiffers';
      proposals.push({ hr: h, db: d, birthRelation, sameGp, namesOk, basis });
    }
  }
  const based = proposals.filter((p) => p.basis);
  const countHr = countBy(based, (p) => p.hr.sourceId);
  const countDb = countBy(based, (p) => p.db.sourceId);
  const auto = [];
  const review = [];
  for (const p of based) {
    const ambiguous = countHr.get(p.hr.sourceId) > 1 || countDb.get(p.db.sourceId) > 1;
    if (!ambiguous && p.namesOk) auto.push(p);
    else review.push({ ...p, reason: ambiguous ? 'ambiguous: several candidates share this surname and evidence' : 'birth dates agree but first names are not nickname-compatible' });
  }
  const touchedHr = new Set(based.map((p) => p.hr.sourceId));
  const touchedDb = new Set(based.map((p) => p.db.sourceId));
  for (const p of proposals) {
    if (!p.basis && !touchedHr.has(p.hr.sourceId) && !touchedDb.has(p.db.sourceId)) {
      review.push({ ...p, reason: 'same surname only: birth dates and GP pattern do not confirm' });
    }
  }
  return {
    auto,
    review: review.map((p) => ({
      id: `hrdb:hr:${p.hr.sourceId}:db:${p.db.sourceId}`,
      kind: 'hrdb',
      title: `Same person in both WHA sources? ${p.hr.name} (HR) / ${p.db.name} (hockeydb)`,
      reason: p.reason,
      resolutions: ['same-person', 'different-person'],
      refs: { hrId: p.hr.sourceId, dbId: p.db.sourceId },
      proposal: p,
      evidence: evidence({ hr: p.hr, db: p.db }),
    })),
  };
}

/** Field-by-field disagreements for an HR/DB pair. DB's generic "F" is compatible with any forward. */
export function pairDisagreements(h, d) {
  const out = {};
  const missing = [];
  const field = (k, a, b) => {
    if (a == null && b == null) return;
    if (a == null || b == null) { missing.push({ field: k, hr: a ?? null, db: b ?? null }); return; }
    if (a !== b) out[k] = { hr: a, db: b };
  };
  field('birthDate', h.birthDate, d.birthDate);
  field('country', h.country, d.country);
  const hp = h.positionNhlStyle ?? null;
  const dp = d.positionNhlStyle ?? null;
  if (d.position === 'F' && hp && ['C', 'L', 'R'].includes(hp)) {
    missing.push({ field: 'position', hr: hp, db: 'F (generic forward)' });
  } else {
    field('position', hp, dp ?? d.position ?? null);
  }
  const seasons = [];
  const all = [...new Set([...h.seasons, ...d.seasons].map((s) => s.season))].sort();
  for (const season of all) {
    const a = h.seasons.find((s) => s.season === season) ?? null;
    const b = d.seasons.find((s) => s.season === season) ?? null;
    if (!a || !b || a.regularGP !== b.regularGP || a.playoffGP !== b.playoffGP) {
      seasons.push({ season, hr: a && { regularGP: a.regularGP, playoffGP: a.playoffGP }, db: b && { regularGP: b.regularGP, playoffGP: b.playoffGP } });
    }
  }
  if (seasons.length) out.seasons = seasons;
  if (h.totals.regularGP !== d.totals.regularGP || h.totals.playoffGP !== d.totals.playoffGP) out.totals = { hr: h.totals, db: d.totals };
  return { disagreements: out, missing };
}

// ---------------------------------------------------------------- 2. WHA <-> NHL

/** Tier of one WHA entity against one NHL player with the same normalised last name. */
export function nhlTier(entity, nhl) {
  if (normName(entity.lastName) !== normName(nhl.lastName)) return null;
  const rels = entity.birthDates.map((d) => compareBirthDates(d, nhl.birthDate));
  if (rels.includes('equal')) return 'A';
  if (rels.includes('same-year')) return 'B';
  if (!rels.length || rels.every((r) => r === 'missing')) return 'B'; // cannot be ruled out without a date
  return 'C';
}

export function matchNhl(entities, nhlPlayers) {
  const nhlByLast = groupBy(nhlPlayers, (n) => normName(n.lastName));
  const pairs = [];
  const collisions = [];
  for (const e of entities) {
    for (const n of nhlByLast.get(normName(e.lastName)) ?? []) {
      const tier = nhlTier(e, n);
      const namesOk = e.nameRecords.some((r) => namesCompatible(r, n));
      if (tier === 'C') collisions.push({ entity: e, nhl: n, namesOk });
      else pairs.push({ entity: e, nhl: n, tier, namesOk });
    }
  }
  const perEntity = countBy(pairs, (p) => p.entity.key);
  const perNhl = countBy(pairs, (p) => p.nhl.playerId);
  const auto = [];
  const review = [];
  for (const p of pairs) {
    const conflict = perEntity.get(p.entity.key) > 1 || perNhl.get(p.nhl.playerId) > 1;
    if (p.tier === 'A' && p.namesOk && !conflict) { auto.push(p); continue; }
    const reasons = [];
    if (p.tier === 'B') reasons.push(p.nhl.birthDate && p.entity.birthDates.length ? 'tier B: same surname and birth year, birth dates differ (possible typo)' : 'tier B: birth date missing on one side');
    if (p.tier === 'A' && !p.namesOk) reasons.push('tier A birth date + surname, but first names are not nickname-compatible');
    if (conflict) reasons.push('conflict: more than one tier A/B candidate on one side');
    review.push({
      id: `nhl:${p.entity.key}:${p.nhl.playerId}`,
      kind: 'nhl',
      title: `WHA ${p.entity.displayName} is NHL-layer ${p.nhl.firstName} ${p.nhl.lastName} (${p.nhl.playerId})?`,
      reason: reasons.join('; '),
      resolutions: ['same-person', 'different-person'],
      refs: { entityKey: p.entity.key, playerId: p.nhl.playerId },
      pair: p,
      evidence: evidence({ hr: p.entity.hr, db: p.entity.db, nhl: p.nhl }),
    });
  }
  return { pairs, auto, review, collisions };
}

// ---------------------------------------------------------------- full reconcile (pure)

/**
 * @param {object} input { hr, db, nhl, decisions, ids, hrSeasonPositions? }
 *   hr/db: source files, nhl: players.json array, decisions: decisions file JSON,
 *   ids: wha-ids.json JSON, hrSeasonPositions: Map sourceId -> [{season, pos}] (optional).
 * @returns {{ report, idsFile, idsChanged, warnings }}
 */
export function reconcile({ hr, db, nhl, decisions: decisionsJson, ids: idsJson, hrSeasonPositions = null }) {
  validateSourceFile(hr, 'hockeyreference');
  validateSourceFile(db, 'hockeydb');
  validateNhlPlayers(nhl);
  validateIdsFile(idsJson);
  const decisions = indexDecisions(decisionsJson);
  const used = new Set();
  const openItems = [];
  const resolved = [];
  const warnings = [];
  const handle = (item) => {
    const d = resolveItem(item, decisions, used);
    if (d) resolved.push({ id: item.id, kind: item.kind, resolution: d.resolution, note: d.note ?? '', ...(d.value !== undefined ? { value: d.value } : {}) });
    else openItems.push(item);
    return d;
  };

  // 1. HR <-> DB
  const src = matchSources(hr.players, db.players);
  const pairs = src.auto.map((p) => ({ ...p, decided: false }));
  for (const item of src.review) {
    const d = handle(item);
    if (d?.resolution === 'same-person') pairs.push({ ...item.proposal, basis: item.proposal.basis ?? 'owner-decision', decided: true });
  }
  const pairedHr = new Map();
  const pairedDb = new Map();
  for (const p of pairs) {
    if (pairedHr.has(p.hr.sourceId) || pairedDb.has(p.db.sourceId)) fail(`HR/DB pairing is not one-to-one around ${p.hr.sourceId} / ${p.db.sourceId} (check hrdb decisions)`);
    pairedHr.set(p.hr.sourceId, p);
    pairedDb.set(p.db.sourceId, p);
  }
  const unmatchedHr = hr.players.filter((h) => !pairedHr.has(h.sourceId));
  const unmatchedDb = db.players.filter((d) => !pairedDb.has(d.sourceId));
  for (const h of unmatchedHr) warnings.push(`HR ${h.sourceId} ${h.name} has no hockeydb match`);
  for (const d of unmatchedDb) warnings.push(`hockeydb ${d.sourceId} ${d.name} has no HR match`);

  // Entities: one per real person on the WHA side, keyed by HR id when present.
  const mkEntity = (h, d, pair) => {
    const base = h ?? d;
    return {
      key: h ? `hr:${h.sourceId}` : `db:${d.sourceId}`,
      hr: h, db: d, pair,
      firstName: base.firstName, lastName: base.lastName, displayName: base.name,
      birthDates: [...new Set([h?.birthDate, d?.birthDate].filter(Boolean))],
      nameRecords: [h, d].filter(Boolean),
    };
  };
  const entities = [
    ...hr.players.map((h) => mkEntity(h, pairedHr.get(h.sourceId)?.db ?? null, pairedHr.get(h.sourceId) ?? null)),
    ...unmatchedDb.map((d) => mkEntity(null, d, null)),
  ];

  const sourcePairs = pairs
    .map((p) => ({ entityKey: `hr:${p.hr.sourceId}`, hrId: p.hr.sourceId, dbId: p.db.sourceId, name: p.hr.name, dbName: p.db.name, basis: p.basis, decided: p.decided, firstNamesCompatible: p.namesOk, ...pairDisagreements(p.hr, p.db) }))
    .sort((a, b) => cmp(a.entityKey, b.entityKey));

  // 2. WHA <-> NHL
  const nm = matchNhl(entities, nhl);
  const accepted = nm.auto.map((p) => ({ ...p, via: 'auto' }));
  const pendingKeys = new Set();
  for (const item of nm.review) {
    const d = handle(item);
    if (d?.resolution === 'same-person') accepted.push({ ...item.pair, via: 'decision' });
    else if (!d) pendingKeys.add(item.refs.entityKey);
  }
  const nhlFor = new Map();
  const takenNhl = new Set();
  for (const p of accepted) {
    if (nhlFor.has(p.entity.key) || takenNhl.has(p.nhl.playerId)) {
      fail(`WHA<->NHL matches are not one-to-one around ${p.entity.key} / ${p.nhl.playerId} (check nhl: decisions)`);
    }
    nhlFor.set(p.entity.key, p);
    takenNhl.add(p.nhl.playerId);
  }
  for (const k of nhlFor.keys()) pendingKeys.delete(k);

  // Birth dates and GP per entity (review items where sources disagree without a majority).
  const birth = new Map();
  const majorityResolved = [];
  const seasonsFor = new Map();
  for (const e of entities) {
    const match = nhlFor.get(e.key);
    const prop = proposeBirthDate({ hr: e.hr?.birthDate ?? null, db: e.db?.birthDate ?? null, nhl: match?.nhl.birthDate ?? null });
    let value = prop.value;
    let basis = prop.basis;
    if (prop.conflict) {
      const resolutions = [...['hr', 'db', 'nhl'].filter((s) => prop.sources[s]).map((s) => `use-${s}`), 'custom'];
      const item = {
        id: `birthdate:${e.key}`,
        kind: 'birthdate',
        title: `Birth date for ${e.displayName}`,
        reason: Object.keys(prop.sources).length ? `sources disagree with no 2-source majority: ${Object.entries(prop.sources).map(([k, v]) => `${SOURCE_LABEL[k]} ${v}`).join(', ')}; proposing HR's` : 'no source has a birth date',
        resolutions,
        refs: { entityKey: e.key, ...(match ? { playerId: match.nhl.playerId } : {}) },
        proposedValue: prop.value,
        evidence: evidence({ hr: e.hr, db: e.db, nhl: match?.nhl ?? null }),
      };
      const d = handle(item);
      if (d) {
        value = d.resolution === 'custom' ? d.value : prop.sources[d.resolution.slice(4)];
        basis = `decision:${d.resolution}`;
      } else {
        basis = `${prop.basis} (pending review)`;
      }
    } else if (prop.basis === 'majority') {
      majorityResolved.push({ entityKey: e.key, name: e.displayName, value: prop.value, agreeing: prop.agreeing, dissenting: prop.dissenting, sources: prop.sources });
    }
    birth.set(e.key, { value, basis, sources: prop.sources });

    // Seasons: HR is primary; per-season HR/DB disagreements become review items.
    const primary = (e.hr ?? e.db).seasons.map((s) => ({ season: s.season, regularGP: s.regularGP, playoffGP: s.playoffGP }));
    const byseason = new Map(primary.map((s) => [s.season, s]));
    if (e.hr && e.db) {
      for (const diff of pairDisagreements(e.hr, e.db).disagreements.seasons ?? []) {
        const item = {
          id: `gp:${e.key}:${diff.season}`,
          kind: 'gp',
          title: `GP for ${e.displayName} in ${diff.season}`,
          reason: `HR ${fmtGp(diff.hr)} vs hockeydb ${fmtGp(diff.db)}; proposing HR's`,
          resolutions: ['use-hr', 'use-db', 'custom'],
          refs: { entityKey: e.key, season: diff.season },
          evidence: evidence({ hr: e.hr, db: e.db }),
        };
        const d = handle(item);
        const chosen = d?.resolution === 'use-db' ? diff.db : d?.resolution === 'custom' ? d.value : diff.hr;
        if (chosen && chosen.regularGP + chosen.playoffGP > 0) byseason.set(diff.season, { season: diff.season, regularGP: chosen.regularGP, playoffGP: chosen.playoffGP });
        else byseason.delete(diff.season);
      }
    }
    seasonsFor.set(e.key, [...byseason.values()].sort((a, b) => cmp(a.season, b.season)));
  }

  // 3. IDs + merge preview
  const whaOnly = entities.filter((e) => !nhlFor.has(e.key) && !pendingKeys.has(e.key));
  const idRes = assignWhaIds(idsJson.assignments, whaOnly.map((e) => ({
    key: e.key, lastName: e.lastName, firstName: e.firstName, birthDate: birth.get(e.key).value, name: `${e.lastName}, ${e.firstName}`,
  })));
  const retiredIds = idsJson.assignments.filter((a) => nhlFor.has(a.key)).map((a) => ({ ...a, nowPlayerId: nhlFor.get(a.key).nhl.playerId }));
  const missingKeys = idsJson.assignments.filter((a) => !entities.some((e) => e.key === a.key));
  for (const a of missingKeys) warnings.push(`wha-ids.json key ${a.key} (${a.playerId}) no longer appears in the sources; kept, never reused`);

  const sourceBlock = (e) => ({
    site: 'hockey-reference.com', definitive: false, crossCheck: e.db ? 'hockeydb.com' : null,
    hockeyreferenceId: e.hr?.sourceId ?? null, hockeydbId: e.db?.sourceId ?? null,
  });
  const merge = entities.map((e) => {
    const seasons = seasonsFor.get(e.key);
    const wha = { regularGP: sum(seasons, 'regularGP'), playoffGP: sum(seasons, 'playoffGP'), seasons, position: e.hr?.positionNhlStyle ?? e.db?.positionNhlStyle ?? null };
    const b = birth.get(e.key);
    const birthDate = { value: b.value, basis: b.basis, sources: b.sources };
    const openForEntity = openItems.filter((i) => i.refs.entityKey === e.key).map((i) => i.id);
    const m = nhlFor.get(e.key);
    if (m) {
      return {
        key: e.key, action: 'extend-nhl', playerId: m.nhl.playerId, name: m.nhl.name, matchTier: m.tier, matchedVia: m.via,
        birthDate, changesCuratedBirthDate: b.value !== m.nhl.birthDate, wha, whaSource: sourceBlock(e), openReviewItems: openForEntity,
      };
    }
    if (pendingKeys.has(e.key)) {
      return { key: e.key, action: 'pending-review', playerId: null, name: `${e.lastName}, ${e.firstName}`, birthDate, wha, whaSource: sourceBlock(e), openReviewItems: openForEntity };
    }
    return {
      key: e.key, action: 'new-wha-only', playerId: idRes.idFor(e.key),
      record: {
        playerId: idRes.idFor(e.key),
        firstName: e.firstName, lastName: e.lastName, name: `${e.lastName}, ${e.firstName}`,
        country: e.hr?.country ?? e.db?.country ?? null,
        birthDate: b.value,
        positions: wha.position ? [wha.position] : [],
        rookieSeason: null,
        jets: { regularGP: 0, playoffGP: 0, seasons: [] },
        wha,
        draft: null,
        qualifiedBy: ['played'],
        source: sourceBlock(e),
      },
      openReviewItems: openForEntity,
    };
  }).sort((a, b) => cmp(a.key, b.key));

  // Informational lists
  const positionsHrVsDb = sourcePairs
    .filter((p) => p.disagreements.position)
    .map((p) => ({ name: p.name, hr: p.disagreements.position.hr, db: p.disagreements.position.db }));
  const genericF = sourcePairs.filter((p) => p.missing.some((m) => m.field === 'position')).map((p) => p.name);
  const positionsWhaVsNhl = [...nhlFor.values()]
    .map((m) => ({ name: m.entity.displayName, playerId: m.nhl.playerId, wha: m.entity.hr?.positionNhlStyle ?? m.entity.db?.positionNhlStyle ?? null, nhl: m.nhl.positions ?? [] }))
    .filter((x) => x.wha && !x.nhl.includes(x.wha))
    .sort((a, b) => cmp(a.name, b.name));
  for (const item of openItems.filter((i) => i.kind === 'nhl')) {
    const w = item.pair.entity.hr?.positionNhlStyle;
    if (w && !(item.pair.nhl.positions ?? []).includes(w)) positionsWhaVsNhl.push({ name: item.pair.entity.displayName, playerId: item.pair.nhl.playerId, wha: w, nhl: item.pair.nhl.positions, pending: true });
  }
  let hrSeasonChanges = null;
  if (hrSeasonPositions) {
    hrSeasonChanges = [];
    for (const h of hr.players) {
      const rows = hrSeasonPositions.get(h.sourceId) ?? [];
      const counts = countBy(rows, (r) => r.pos);
      if (counts.size < 2) continue;
      const top = Math.max(...counts.values());
      hrSeasonChanges.push({
        name: h.name, hrId: h.sourceId, perSeason: rows, chosen: h.position,
        tie: [...counts.values()].filter((c) => c === top).length > 1,
      });
    }
  }
  const collisions = nm.collisions
    .map((c) => ({ wha: c.entity.displayName, whaBirthDate: c.entity.birthDates.join(' / '), nhl: `${c.nhl.firstName} ${c.nhl.lastName}`, playerId: c.nhl.playerId, nhlBirthDate: c.nhl.birthDate, firstNamesCompatible: c.namesOk }))
    .sort((a, b) => cmp(a.wha, b.wha) || a.playerId - b.playerId);

  warnings.push(...staleDecisionWarnings(decisions, used));

  const tierCount = (t) => nm.pairs.filter((p) => p.tier === t).length;
  const stats = {
    hr: hr.players.length,
    db: db.players.length,
    hrDbMatched: pairs.length,
    hrDbMatchedByBasis: Object.fromEntries(countBy(pairs, (p) => p.basis)),
    hrUnmatched: unmatchedHr.length,
    dbUnmatched: unmatchedDb.length,
    entities: entities.length,
    pairsWithDisagreements: sourcePairs.filter((p) => Object.keys(p.disagreements).length).length,
    nhlTierA: tierCount('A'),
    nhlTierB: tierCount('B'),
    nhlTierC: nm.collisions.length,
    nhlMatched: nhlFor.size,
    nhlMatchedAuto: [...nhlFor.values()].filter((m) => m.via === 'auto').length,
    pendingNhlReview: pendingKeys.size,
    whaOnly: whaOnly.length,
    openReviewItems: openItems.length,
    resolvedReviewItems: resolved.length,
    newIdsAssigned: idRes.added.length,
    idsTotal: idRes.assignments.length,
  };

  const report = {
    inputs: {
      hockeyreference: { generatedAt: hr.generatedAt ?? null, players: hr.players.length },
      hockeydb: { generatedAt: db.generatedAt ?? null, players: db.players.length },
      nhlLayer: { players: nhl.length },
      decisions: decisions.size,
    },
    stats,
    warnings,
    sourceMatching: { pairs: sourcePairs, unmatchedHr: unmatchedHr.map((h) => h.sourceId), unmatchedDb: unmatchedDb.map((d) => d.sourceId) },
    nhlMatching: {
      matches: [...nhlFor.values()].map((m) => ({ entityKey: m.entity.key, name: m.entity.displayName, playerId: m.nhl.playerId, nhlName: m.nhl.name, tier: m.tier, via: m.via, firstNamesCompatible: m.namesOk, whaBirthDates: m.entity.birthDates, nhlBirthDate: m.nhl.birthDate })).sort((a, b) => cmp(a.entityKey, b.entityKey)),
      sameSurnameCollisions: collisions,
    },
    reviewItems: openItems.map(stripInternal),
    resolvedItems: resolved,
    birthDates: { majorityResolved },
    positions: { hrVsDb: positionsHrVsDb, dbGenericForward: genericF, hrSeasonChanges, whaVsNhl: positionsWhaVsNhl },
    ids: { added: idRes.added, retired: retiredIds },
    merge,
  };
  return {
    report,
    idsFile: { ...idsJson, assignments: idRes.assignments },
    idsChanged: idRes.added.length > 0,
    warnings,
  };
}

const fmtGp = (g) => (g ? `${g.regularGP}/${g.playoffGP}` : 'absent');
function stripInternal({ proposal, pair, ...rest }) { return rest; }

function groupBy(list, fn) {
  const m = new Map();
  for (const x of list) {
    const k = fn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}
function countBy(list, fn) {
  const m = new Map();
  for (const x of list) m.set(fn(x), (m.get(fn(x)) ?? 0) + 1);
  return m;
}

// ---------------------------------------------------------------- markdown

const esc = (v) => (v === null || v === undefined || v === '' ? '—' : String(v).replace(/\|/g, '\\|'));

export function renderReview(report) {
  const s = report.stats;
  const L = [];
  L.push('# WHA reconciliation review', '');
  L.push(`Generated by \`npm run reconcile:wha\` from HR (${report.inputs.hockeyreference.generatedAt}) and hockeydb (${report.inputs.hockeydb.generatedAt}). Nothing here has been written to \`players.json\`.`, '');
  L.push('## Summary', '');
  L.push(`- WHA players: HR ${s.hr}, hockeydb ${s.db}; matched across sources ${s.hrDbMatched} (unmatched HR ${s.hrUnmatched}, hockeydb ${s.dbUnmatched}).`);
  L.push(`- NHL layer: tier A ${s.nhlTierA}, tier B ${s.nhlTierB}, tier C (same surname, different person) ${s.nhlTierC}. Matched ${s.nhlMatched} (${s.nhlMatchedAuto} automatic), pending review ${s.pendingNhlReview}, WHA-only ${s.whaOnly}.`);
  L.push(`- Review items open: **${s.openReviewItems}**; resolved by decisions: ${s.resolvedReviewItems}. New reserved ids this run: ${s.newIdsAssigned} (total ${s.idsTotal}).`);
  if (report.warnings.length) {
    L.push('', '**Warnings**', '');
    for (const w of report.warnings) L.push(`- ${w}`);
  }
  L.push('', '## Review items', '');
  if (!report.reviewItems.length) L.push('None open.');
  L.push('To resolve, add an object to the `decisions` array in `data/decisions/wha-decisions.json` (pick one option, fill in `note`), then re-run.', '');
  report.reviewItems.forEach((item, i) => {
    L.push(`### ${i + 1}. ${item.title}`, '');
    L.push(`id \`${item.id}\` — ${item.reason}`, '');
    const cols = ['hr', 'db', 'nhl'].filter((k) => item.evidence[k]);
    L.push(`| | ${cols.map((k) => SOURCE_LABEL[k]).join(' | ')} |`);
    L.push(`|---|${cols.map(() => '---').join('|')}|`);
    const rows = [['ID', 'id'], ['Name', 'name'], ['Full name', 'fullName'], ['Nickname', 'nickname'], ['Birth date', 'birthDate'], ['Birthplace', 'birthplace'], ['Country', 'country'], ['Position', 'position'], ['Seasons (reg/playoff GP)', 'seasons'], ['Totals', 'totals']];
    for (const [label, k] of rows) {
      const vals = cols.map((c) => item.evidence[c][k]);
      if (vals.every((v) => v == null)) continue;
      const differ = new Set(vals.filter((v) => v != null)).size > 1 && ['birthDate', 'position', 'seasons'].includes(k);
      L.push(`| ${differ ? `**${label}**` : label} | ${vals.map(esc).join(' | ')} |`);
    }
    L.push('', '```json');
    for (const r of item.resolutions) {
      const snippet = { id: item.id, resolution: r, note: '' };
      if (r === 'custom') snippet.value = item.kind === 'gp' ? { regularGP: 0, playoffGP: 0 } : 'YYYY-MM-DD';
      L.push(JSON.stringify(snippet));
    }
    L.push('```', '');
  });

  if (report.resolvedItems.length) {
    L.push('## Applied decisions', '');
    for (const r of report.resolvedItems) L.push(`- \`${r.id}\` -> ${r.resolution}${r.value !== undefined ? ` ${JSON.stringify(r.value)}` : ''}${r.note ? ` (${r.note})` : ''}`);
    L.push('');
  }

  L.push('## For information', '');
  L.push('### Birth dates settled by 2-source agreement', '');
  if (!report.birthDates.majorityResolved.length) L.push('None.');
  for (const m of report.birthDates.majorityResolved) {
    L.push(`- ${m.name}: ${m.value} (${m.agreeing.map((k) => SOURCE_LABEL[k]).join(' + ')}); ${m.dissenting.map((k) => `${SOURCE_LABEL[k]} says ${m.sources[k]}`).join(', ')}`);
  }
  const changes = report.merge.filter((m) => m.changesCuratedBirthDate);
  if (changes.length) {
    L.push('', 'Proposed birth date differs from the curated NHL value:', '');
    for (const m of changes) L.push(`- ${m.name} (${m.playerId}): curated ${m.birthDate.sources.nhl ?? '—'} -> proposed ${m.birthDate.value} (${m.birthDate.basis})`);
  }
  L.push('', '### Position: per-season changes on Hockey-Reference (stored as the majority; ties -> most recent)', '');
  if (!report.positions.hrSeasonChanges) L.push('Not available (HR team-page cache missing; the HR reference file only stores the majority position).');
  else if (!report.positions.hrSeasonChanges.length) L.push('None.');
  else for (const c of report.positions.hrSeasonChanges) L.push(`- ${c.name}: ${c.perSeason.map((r) => `${r.season} ${r.pos}`).join(', ')} -> ${c.chosen}${c.tie ? ' (tie)' : ''}`);
  L.push('', '### Position: WHA (HR) differs from NHL layer', '');
  if (!report.positions.whaVsNhl.length) L.push('None.');
  for (const p of report.positions.whaVsNhl) L.push(`- ${p.name} (${p.playerId}): WHA ${p.wha}, NHL ${p.nhl.join('/') || '—'}${p.pending ? ' (match pending review)' : ''}`);
  L.push('', '### Position: HR vs hockeydb', '');
  if (!report.positions.hrVsDb.length) L.push('None.');
  for (const p of report.positions.hrVsDb) L.push(`- ${p.name}: HR ${p.hr}, hockeydb ${p.db}`);
  if (report.positions.dbGenericForward.length) L.push(`- hockeydb lists only "F" for: ${report.positions.dbGenericForward.join(', ')} (HR position used)`);
  L.push('', '### Same surname, different person (tier C; no action needed)', '');
  if (!report.nhlMatching.sameSurnameCollisions.length) L.push('None.');
  for (const c of report.nhlMatching.sameSurnameCollisions) L.push(`- WHA ${c.wha} (${c.whaBirthDate}) vs NHL ${c.nhl} ${c.playerId} (${c.nhlBirthDate ?? '—'})${c.firstNamesCompatible ? ' — first names compatible' : ''}`);
  L.push('');
  return L.join('\n');
}

// ---------------------------------------------------------------- CLI

async function readJson(file, label, { optional = false, fallback } = {}) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if (optional && err.code === 'ENOENT') return fallback;
    throw new Error(`reconcile-wha: cannot read ${label} (${file}): ${err.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`reconcile-wha: ${label} is not valid JSON: ${err.message}`);
  }
}

/** Per-season HR positions from the cached team pages, or null when the cache is absent. */
async function loadHrSeasonPositions() {
  const { parseTeamSeason, seasonLabel } = await import('./get-hockeyreference-wha.mjs');
  const out = new Map();
  for (const end of HR_END_YEARS) {
    let html;
    try {
      html = await readFile(resolve(PATHS.hrCache, `team_WNJ_${end}.html`), 'utf8');
    } catch {
      return null;
    }
    for (const [id, r] of parseTeamSeason(html)) {
      if (!r.pos || r.regularGP + r.playoffGP === 0) continue;
      if (!out.has(id)) out.set(id, []);
      out.get(id).push({ season: seasonLabel(end), pos: r.pos });
    }
  }
  return out;
}

async function main() {
  const hr = await readJson(PATHS.hr, 'hockeyreference-wha-jets.json');
  const db = await readJson(PATHS.db, 'hockeydb-wha-jets.json');
  const nhl = await readJson(PATHS.nhl, 'players.json');
  const decisions = await readJson(PATHS.decisions, 'wha-decisions.json', { optional: true, fallback: { decisions: [] } });
  const ids = await readJson(PATHS.ids, 'wha-ids.json', { optional: true, fallback: null });
  const idsJson = ids ?? {
    description: 'Reserved playerIds (900001+) for WHA-only players. Append-only: never renumber or reuse. Written by scripts/reconcile-wha.mjs.',
    assignments: [],
  };
  const hrSeasonPositions = await loadHrSeasonPositions();

  const { report, idsFile, idsChanged, warnings } = reconcile({ hr, db, nhl, decisions, ids: idsJson, hrSeasonPositions });

  await mkdir(dirname(PATHS.report), { recursive: true });
  await writeFile(PATHS.report, JSON.stringify(report, null, 2) + '\n');
  await writeFile(PATHS.review, renderReview(report));
  if (idsChanged || !ids) {
    await mkdir(dirname(PATHS.ids), { recursive: true });
    await writeFile(PATHS.ids, JSON.stringify(idsFile, null, 2) + '\n');
  }

  const s = report.stats;
  console.log(`HR ${s.hr} / hockeydb ${s.db}: matched ${s.hrDbMatched} ${JSON.stringify(s.hrDbMatchedByBasis)}, unmatched HR ${s.hrUnmatched} / DB ${s.dbUnmatched}`);
  console.log(`NHL layer: tier A ${s.nhlTierA}, tier B ${s.nhlTierB}, tier C ${s.nhlTierC}; matched ${s.nhlMatched}, pending ${s.pendingNhlReview}, WHA-only ${s.whaOnly}`);
  console.log(`review items open ${s.openReviewItems}, resolved ${s.resolvedReviewItems}; new ids ${s.newIdsAssigned} (total ${s.idsTotal})`);
  for (const w of warnings) console.warn(`WARNING: ${w}`);
  console.log(`Wrote ${PATHS.report}\nWrote ${PATHS.review}${idsChanged || !ids ? `\nWrote ${PATHS.ids}` : ''}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
