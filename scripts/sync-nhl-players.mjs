#!/usr/bin/env node
// Brings the NHL-derived parts of site/data/curated/players.json in line with a fresh NHL pull
// (temp/reference/nhl-jets.json, written by `npm run get:nhl`). Network-free and deterministic.
//
// Rules (owner decisions, see AGENTS.md "Keeping NHL data current"):
//   - ADDED: a playerId in the pull but not in players.json is added with the init:players record
//     shape (source nhl.com, definitive). Before adding, existing players are compared by normalised
//     lastName + birthDate; a match is a CONFLICT (never a duplicate) until an `add:<id>` decision.
//   - AUTO-UPDATED (no approval): nhl.seasons rows of the two most recent seasons present in the pull
//     (derived from the data, not the clock), the recomputed nhl.regularGP/playoffGP, and "played"
//     added to qualifiedBy when a player first has Jets games.
//   - NEEDS REVIEW (diff only, never applied without a decision): nhl.seasons rows of older seasons,
//     firstName/lastName (name is re-derived), country, birthDate, positions, rookieSeason, draft,
//     and the "drafted" flag of qualifiedBy.
//   - Decisions live in data/decisions/nhl-sync-decisions.json:
//       { decisions: [{ id, resolution: "accept" | "keep-curated", note, value? }] }
//     ids: field:<playerId>:<field>  season:<playerId>:<season>:<team>  add:<playerId>
//     "accept" applies the nhl.com value; "keep-curated" is a permanent override (curated value is
//     deliberately different). `value`, when given, is the nhl.com value the decision was made
//     against: if nhl.com later reports something else the item is reopened for review.
//     Decisions that no longer match a difference are reported as stale (warning); decisions for a
//     player who is not in the pull (e.g. WHA players with an NHL id) are reported as dormant.
//   - Never deletes a player (curated players missing from the pull are only reported), never
//     touches wha, notes, needsReview, source or any other field. Idempotent.
//
// Usage: npm run sync:nhl [-- --apply] [-- --allow-open] [-- --allow-stale]
//   default      dry run: prints the grouped report, writes nothing
//   --apply      writes players.json (auto changes + adds + accepted decisions); refuses (exit 1)
//                while review items or conflicts are open
//   --allow-open with --apply: write the safe parts anyway and leave open items listed
//   --allow-stale accept a reference file older than 24 hours
// The result is always validated (scripts/validate.mjs) and an invalid file is never written.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { curatedPlayer } from './init-curated-players.mjs';
import { validatePlayers, validateIdMap, sortableName } from './validate.mjs';
import { comparePlayers } from './wha/merge-wha-into-players.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PATHS = {
  players: resolve(ROOT, 'site', 'data', 'curated', 'players.json'),
  reference: resolve(ROOT, 'temp', 'reference', 'nhl-jets.json'),
  decisions: resolve(ROOT, 'data', 'decisions', 'nhl-sync-decisions.json'),
  ids: resolve(ROOT, 'data', 'decisions', 'wha-ids.json'),
};
export const MAX_REFERENCE_AGE_MS = 24 * 60 * 60 * 1000;
export const IDENTITY_FIELDS = ['firstName', 'lastName', 'country', 'birthDate', 'positions', 'rookieSeason', 'draft'];
const RESOLUTIONS = ['accept', 'keep-curated'];
const OPTIONS = ['--apply', '--allow-open', '--allow-stale'];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sum = (rows, key) => rows.reduce((t, r) => t + r[key], 0);
const rowKey = (r) => `${r.season}|${r.team}`;
const byRow = (a, b) => a.season.localeCompare(b.season) || a.team.localeCompare(b.team);
const show = (v) => (v === undefined ? '(absent)' : JSON.stringify(v));
const seasonRowText = (r) => (r ? `${r.regularGP} GP / ${r.playoffGP} playoff GP` : '(no row)');

/** Lowercase ASCII letters only (accents, spaces, hyphens, apostrophes removed) for identity matching. */
export const normaliseName = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

/** The two most recent season labels present in the pull (from the data, not the clock). */
export function recentSeasons(reference, count = 2) {
  const all = new Set(reference.players.flatMap((p) => (p.seasons ?? []).map((s) => s.season)));
  return [...all].sort().reverse().slice(0, count).sort();
}

/** Error message if the reference pull is missing a valid generatedAt or older than maxAgeMs, else null. */
export function referenceAgeProblem(reference, now, maxAgeMs = MAX_REFERENCE_AGE_MS) {
  const at = Date.parse(reference?.generatedAt ?? '');
  if (Number.isNaN(at)) return 'reference file has no valid generatedAt';
  const age = now.getTime() - at;
  if (age > maxAgeMs) return `reference file is ${(age / 3600000).toFixed(1)} h old (generatedAt ${reference.generatedAt}); run \`npm run get:nhl\` or pass --allow-stale`;
  return null;
}

/** Checks the decisions file shape; returns Map id -> decision. Throws on malformed input. */
export function indexDecisions(decisionsJson) {
  const list = decisionsJson?.decisions;
  if (!Array.isArray(list)) throw new Error('nhl-sync-decisions.json: "decisions" must be an array');
  const map = new Map();
  for (const d of list) {
    if (typeof d?.id !== 'string' || !/^(field:\d+:[A-Za-z.]+|season:\d+:\d{4}-\d{2}:[A-Z]+|add:\d+)$/.test(d.id)) throw new Error(`nhl-sync-decisions.json: bad decision id ${show(d?.id)}`);
    if (!RESOLUTIONS.includes(d.resolution)) throw new Error(`nhl-sync-decisions.json: ${d.id}: resolution must be one of ${RESOLUTIONS.join(', ')}`);
    if (typeof d.note !== 'string' || !d.note.trim()) throw new Error(`nhl-sync-decisions.json: ${d.id}: note is required`);
    if (map.has(d.id)) throw new Error(`nhl-sync-decisions.json: duplicate decision id ${d.id}`);
    map.set(d.id, d);
  }
  return map;
}

/** Differences between a curated player and its reference record (curated shape) needing review. */
function reviewDiffs(c, r, refQualified, recent) {
  const diffs = [];
  for (const f of IDENTITY_FIELDS) {
    if (!same(c[f], r[f])) diffs.push({ id: `field:${c.playerId}:${f}`, kind: 'field', field: f, curated: c[f], nhl: r[f] });
  }
  const cd = (c.qualifiedBy ?? []).includes('drafted');
  const rd = refQualified.includes('drafted');
  if (cd !== rd) diffs.push({ id: `field:${c.playerId}:qualifiedBy.drafted`, kind: 'field', field: 'qualifiedBy.drafted', curated: cd, nhl: rd });
  for (const d of seasonDiffs(c.nhl.seasons, r.nhl.seasons)) {
    if (recent.includes(d.season)) continue;
    diffs.push({ id: `season:${c.playerId}:${d.season}:${d.team}`, kind: 'season', field: `nhl.seasons ${d.season} ${d.team}`, season: d.season, team: d.team, curated: d.curated, nhl: d.nhl });
  }
  return diffs;
}

/** Row-level differences between two nhl.seasons lists ({ season, team, curated, nhl } with null for a missing row). */
function seasonDiffs(curatedRows, refRows) {
  const cm = new Map(curatedRows.map((s) => [rowKey(s), s]));
  const rm = new Map(refRows.map((s) => [rowKey(s), s]));
  const keys = [...new Set([...cm.keys(), ...rm.keys()])].sort();
  return keys
    .filter((k) => !same(cm.get(k) ?? null, rm.get(k) ?? null))
    .map((k) => { const [season, team] = k.split('|'); return { season, team, curated: cm.get(k) ?? null, nhl: rm.get(k) ?? null }; });
}

/** Replaces/adds/removes one season row (null removes) and keeps rows sorted. */
function setSeasonRow(nhl, season, team, row) {
  const rows = nhl.seasons.filter((s) => !(s.season === season && s.team === team));
  if (row) rows.push(structuredClone(row));
  rows.sort(byRow);
  nhl.seasons = rows;
}

function recomputeTotals(nhl) {
  nhl.regularGP = sum(nhl.seasons, 'regularGP');
  nhl.playoffGP = sum(nhl.seasons, 'playoffGP');
}

const gp = (block) => (block ? block.regularGP + block.playoffGP : 0);

function applyField(p, field, value) {
  if (field === 'qualifiedBy.drafted') {
    const rest = p.qualifiedBy.filter((q) => q !== 'drafted');
    p.qualifiedBy = value ? [...rest, 'drafted'] : rest;
    return;
  }
  p[field] = structuredClone(value);
  if (field === 'firstName' || field === 'lastName') p.name = sortableName(p.firstName, p.lastName);
}

/** Does a decision still match the nhl.com value it was made against? (No `value` = matches any.) */
const decisionMatches = (d, nhlValue) => !('value' in d) || same(d.value, nhlValue);

function whyQualifies(p) {
  const parts = [];
  if (p.qualifiedBy.includes('played')) parts.push(`played ${p.nhl.seasons.map((s) => `${s.season} ${s.team}`).join(', ')} (${p.nhl.regularGP} GP, ${p.nhl.playoffGP} playoff GP)`);
  if (p.qualifiedBy.includes('drafted')) parts.push(`drafted ${p.draft.year} #${p.draft.overall} by ${p.draft.team}`);
  return parts.join('; ');
}

/**
 * Pure sync. Inputs are not modified.
 * @param {object[]} curated players.json
 * @param {{ generatedAt: string, players: object[] }} reference temp/reference/nhl-jets.json
 * @param {{ decisions: object[] }} decisionsJson data/decisions/nhl-sync-decisions.json
 * @returns {{ players: object[], report: object }}
 */
export function syncNhl(curated, reference, decisionsJson = { decisions: [] }) {
  if (!Array.isArray(curated)) throw new Error('sync-nhl: players.json must be an array');
  if (!Array.isArray(reference?.players)) throw new Error('sync-nhl: reference has no players array');
  const decisions = indexDecisions(decisionsJson);
  const used = new Set();
  const retrieved = String(reference.generatedAt).slice(0, 10);
  const recent = recentSeasons(reference);
  const players = curated.map((p) => structuredClone(p));
  const byId = new Map(players.map((p) => [p.playerId, p]));
  const original = new Map(curated.map((p) => [p.playerId, p]));
  const refIds = new Set(reference.players.map((p) => p.playerId));
  const report = { recentSeasons: recent, added: [], autoUpdated: [], review: [], conflicts: [], overrides: [], accepted: [], dormant: [], stale: [], missing: [], missingOther: 0, reopened: [] };

  for (const ref of reference.players) {
    const r = curatedPlayer(ref, retrieved);
    const c = byId.get(r.playerId);
    if (!c) {
      const key = [normaliseName(r.lastName), r.birthDate];
      const matches = r.birthDate ? players.filter((p) => normaliseName(p.lastName) === key[0] && p.birthDate === key[1]) : [];
      const d = decisions.get(`add:${r.playerId}`);
      if (d) used.add(d.id);
      if (matches.length && d?.resolution !== 'accept') {
        if (d?.resolution === 'keep-curated') report.overrides.push({ id: d.id, playerId: r.playerId, name: r.name, curated: '(not added)', nhl: matches.map((m) => m.playerId), note: d.note });
        else report.conflicts.push({ id: `add:${r.playerId}`, playerId: r.playerId, name: r.name, birthDate: r.birthDate, why: whyQualifies(r), matches: matches.map((m) => ({ playerId: m.playerId, name: m.name, birthDate: m.birthDate, source: m.source?.site })) });
        continue;
      }
      if (d && !matches.length) report.stale.push(`${d.id}: no conflict exists for this new player (decision not needed)`);
      players.push(r);
      byId.set(r.playerId, r);
      report.added.push({ playerId: r.playerId, name: r.name, qualifiedBy: r.qualifiedBy, why: whyQualifies(r) });
      continue;
    }

    const auto = [];
    for (const d of seasonDiffs(c.nhl.seasons, r.nhl.seasons)) {
      if (!recent.includes(d.season)) continue;
      setSeasonRow(c.nhl, d.season, d.team, d.nhl);
      auto.push(`nhl ${d.season} ${d.team}: ${seasonRowText(d.curated)} -> ${seasonRowText(d.nhl)}`);
    }
    for (const diff of reviewDiffs(c, r, ref.qualifiedBy ?? [], recent)) {
      const d = decisions.get(diff.id);
      if (d) used.add(d.id);
      const entry = { ...diff, playerId: c.playerId, name: c.name };
      // First game of a drafted-only player: rookieSeason is filled (null -> nhl.com) together with the
      // auto-applied games, since a player with games must have one. Changing a set value needs review.
      const debut = diff.field === 'rookieSeason' && diff.curated === null && diff.nhl !== null && sum(c.nhl.seasons, 'regularGP') + sum(c.nhl.seasons, 'playoffGP') + gp(c.wha) >= 1;
      if (debut && !d) {
        applyField(c, 'rookieSeason', diff.nhl);
        auto.push(`rookieSeason: null -> ${show(diff.nhl)} (first Jets game; filled from nhl.com)`);
      } else if (d && !decisionMatches(d, diff.nhl)) {
        report.reopened.push(`${d.id}: decision was made against nhl.com value ${show(d.value)}, nhl.com now has ${show(diff.nhl)}`);
        report.review.push(entry);
      } else if (d?.resolution === 'keep-curated') {
        report.overrides.push({ ...entry, note: d.note });
      } else if (d?.resolution === 'accept') {
        if (diff.kind === 'season') setSeasonRow(c.nhl, diff.season, diff.team, diff.nhl);
        else applyField(c, diff.field, diff.nhl);
        report.accepted.push(entry);
      } else {
        report.review.push(entry);
      }
    }
    const before = original.get(c.playerId);
    if (!same(before.nhl.seasons, c.nhl.seasons)) {
      recomputeTotals(c.nhl);
      const t = before.nhl;
      if (t.regularGP !== c.nhl.regularGP || t.playoffGP !== c.nhl.playoffGP) auto.push(`nhl totals: ${t.regularGP}/${t.playoffGP} -> ${c.nhl.regularGP}/${c.nhl.playoffGP} (regular/playoff GP)`);
    }
    if (Array.isArray(c.qualifiedBy) && !c.qualifiedBy.includes('played') && gp(c.nhl) + gp(c.wha) >= 1) {
      c.qualifiedBy = ['played', ...c.qualifiedBy];
      auto.push(`qualifiedBy: ${show(before.qualifiedBy)} -> ${show(c.qualifiedBy)}`);
    }
    if (auto.length) report.autoUpdated.push({ playerId: c.playerId, name: c.name, changes: auto });
  }

  for (const p of curated) {
    if (refIds.has(p.playerId)) continue;
    if (p.source?.site === 'nhl.com') report.missing.push({ playerId: p.playerId, name: p.name });
    else report.missingOther++;
  }
  for (const [id, d] of decisions) {
    if (used.has(id)) continue;
    const pid = Number(id.split(':')[1]);
    if (byId.has(pid) && !refIds.has(pid)) report.dormant.push({ id, playerId: pid, name: byId.get(pid).name, resolution: d.resolution, value: d.value });
    else if (!byId.has(pid) && !refIds.has(pid)) report.stale.push(`${id}: player ${pid} is in neither players.json nor the pull`);
    else report.stale.push(`${id}: no longer matches a difference between players.json and the pull (${d.resolution === 'accept' ? 'already applied or nhl.com changed' : 'nhl.com now agrees or the field changed'}); safe to remove`);
  }
  players.sort(comparePlayers);
  return { players, report };
}

/** Grouped, human-readable report lines. */
export function formatReport(report, { players = null } = {}) {
  const L = [];
  const section = (title, n) => L.push('', `== ${title} (${n}) ==`);
  L.push(`Most recent seasons in the pull (auto-updated): ${report.recentSeasons.join(', ')}`);
  section('ADDED', report.added.length);
  for (const a of report.added) L.push(`+ ${a.playerId} ${a.name} [${a.qualifiedBy.join(', ')}]: ${a.why}`);
  section('AUTO-UPDATED', report.autoUpdated.length);
  for (const u of report.autoUpdated) {
    L.push(`~ ${u.playerId} ${u.name}`);
    for (const c of u.changes) L.push(`    ${c}`);
  }
  section('NEEDS REVIEW', report.review.length);
  for (const r of report.review) {
    const fmt = r.kind === 'season' ? seasonRowText : show;
    L.push(`? ${r.id}  ${r.name}: ${r.field}: ${fmt(r.curated)} -> ${fmt(r.nhl)}`);
  }
  if (report.review.length) L.push('  Resolve in data/decisions/nhl-sync-decisions.json: { "id", "resolution": "accept" | "keep-curated", "note", "value": <nhl.com value> }');
  for (const x of report.reopened) L.push(`  reopened: ${x}`);
  section('CONFLICTS', report.conflicts.length);
  for (const c of report.conflicts) {
    L.push(`! ${c.id}  ${c.name} (${c.birthDate}) is new in the pull (${c.why}) but matches existing:`);
    for (const m of c.matches) L.push(`    ${m.playerId} ${m.name} (${m.birthDate}, source ${m.source})`);
  }
  if (report.conflicts.length) L.push('  Not added. Usually the existing record should move to this NHL id; or decide add:<id> accept (different person) / keep-curated (never add).');
  section('OVERRIDES IN EFFECT', report.overrides.length);
  for (const o of report.overrides) L.push(`= ${o.id}  ${o.name}: keep ${show(o.curated)} (nhl.com ${show(o.nhl)})`);
  if (report.accepted.length) {
    section('ACCEPTED DECISIONS APPLIED', report.accepted.length);
    for (const a of report.accepted) L.push(`* ${a.id}  ${a.name}: ${show(a.curated)} -> ${show(a.nhl)}`);
  }
  if (report.dormant.length) {
    section('DORMANT DECISIONS (player not in the NHL Jets pull)', report.dormant.length);
    for (const d of report.dormant) L.push(`  ${d.id}  ${d.name}: ${d.resolution}${'value' in d && d.value !== undefined ? ` (against nhl.com ${show(d.value)})` : ''}`);
  }
  section('MISSING FROM PULL (nhl.com-sourced players; not deleted)', report.missing.length);
  for (const m of report.missing) L.push(`- ${m.playerId} ${m.name}`);
  L.push(`  (${report.missingOther} non-nhl.com players, e.g. WHA-only, are not expected in the pull)`);
  if (report.stale.length) {
    L.push('');
    for (const s of report.stale) L.push(`WARNING stale decision ${s}`);
  }
  if (players) L.push('', `players: ${players.length}`);
  return L;
}

export const openItemCount = (report) => report.review.length + report.conflicts.length;

/**
 * Whole command as a pure function (the CLI only does I/O).
 * @param {{ playersText: string, referenceText: string|null, decisionsJson: object|null, idsJson?: object|null, now: Date, args: string[] }} input
 * @returns {{ code: number, out: string[], err: string[], write: string|null }}
 */
export function runSync({ playersText, referenceText, decisionsJson, idsJson = null, now, args }) {
  const out = [];
  const err = [];
  const done = (code, write = null) => ({ code, out, err, write });
  const unknown = args.filter((a) => !OPTIONS.includes(a));
  if (unknown.length) {
    err.push(`Unknown option(s): ${unknown.join(' ')}`, 'Usage: npm run sync:nhl [-- --apply] [-- --allow-open] [-- --allow-stale]');
    return done(2);
  }
  const apply = args.includes('--apply');
  const allowOpen = args.includes('--allow-open');
  if (referenceText === null) {
    err.push('sync-nhl: temp/reference/nhl-jets.json not found; run `npm run get:nhl` first');
    return done(1);
  }
  const reference = JSON.parse(referenceText);
  const age = referenceAgeProblem(reference, now);
  if (age) {
    if (!args.includes('--allow-stale')) {
      err.push(`sync-nhl: ${age}`);
      return done(1);
    }
    out.push(`WARNING: ${age} (continuing: --allow-stale)`);
  }
  const before = JSON.parse(playersText);
  const { players, report } = syncNhl(before, reference, decisionsJson ?? { decisions: [] });
  out.push(`Reference: ${reference.players.length} players, generatedAt ${reference.generatedAt}; players.json: ${before.length} players`);
  out.push(...formatReport(report));

  const errors = [...validatePlayers(players), ...validateIdMap(players, idsJson)];
  if (errors.length) {
    for (const e of errors) err.push(e);
    err.push(`sync-nhl: result fails validation (${errors.length} problem(s)); nothing written`);
    return done(1);
  }
  const open = openItemCount(report);
  const text = JSON.stringify(players, null, 2) + '\n';
  const changed = text !== playersText;
  out.push('', `Summary: added ${report.added.length}, auto-updated ${report.autoUpdated.length}, accepted ${report.accepted.length}, needs review ${report.review.length}, conflicts ${report.conflicts.length}, overrides ${report.overrides.length}, stale decisions ${report.stale.length}${changed ? '' : '; players.json already up to date'}`);
  if (!apply) {
    out.push(changed ? 'Dry run: nothing written (pass --apply to write).' : 'Dry run: no changes.');
    return done(0);
  }
  if (open && !allowOpen) {
    err.push(`sync-nhl: ${open} open item(s) (review/conflicts); nothing written. Resolve them in data/decisions/nhl-sync-decisions.json, or pass --allow-open to write only the safe parts.`);
    return done(1);
  }
  if (!changed) {
    out.push('No changes.');
    return done(0);
  }
  out.push(`Writing players.json${open ? ` (safe parts only; ${open} open item(s) left listed above)` : ''}.`);
  return done(0, text);
}

async function readOrNull(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function main() {
  const decisionsText = await readOrNull(PATHS.decisions);
  const idsText = await readOrNull(PATHS.ids);
  const result = runSync({
    playersText: await readFile(PATHS.players, 'utf8'),
    referenceText: await readOrNull(PATHS.reference),
    decisionsJson: decisionsText ? JSON.parse(decisionsText) : null,
    idsJson: idsText ? JSON.parse(idsText) : null,
    now: new Date(),
    args: process.argv.slice(2),
  });
  for (const l of result.out) console.log(l);
  for (const l of result.err) console.error(l);
  if (result.write !== null) {
    await writeFile(PATHS.players, result.write);
    console.log(`Wrote ${PATHS.players}`);
  }
  return result.code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(e.message); process.exitCode = 1; });
}
