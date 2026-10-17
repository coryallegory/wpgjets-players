#!/usr/bin/env node
// Merges the reconciled WHA Winnipeg Jets players into site/data/curated/players.json (schema v2).
// Deterministic and network-free: re-runs the reconcile logic in-process on the same inputs as
// `npm run reconcile:wha` (HR + hockeydb reference files, players.json, data/decisions/*.json,
// temp/reference/nhl-jets.json for nhl.com birth dates). Idempotent: a second run changes nothing.
//
// What it does:
//   - migrates schema v1 records (`jets` -> `nhl`, same position in the object)
//   - WHA players matched to an NHL record: adds/updates `wha`, sets birthDate to the reconciled
//     value, adds "played" to qualifiedBy if needed, adds provenance notes
//   - WHA-only players: added with their reserved playerId (900001+); on later runs only the fields
//     above are refreshed, so hand edits to names/country/positions/source are kept
//   - fields owned here: birthDate, wha, qualifiedBy ("played"), needsReview entries "birthDate"/"wha",
//     generated notes. Everything else is left as is; generated notes are only appended, except
//     "provisional" notes, which are removed once the review item is resolved.
//   - final array sorted by lastName, firstName, playerId; output must pass scripts/validate.mjs
//
// Refuses while review items are open. With --allow-open, open birth-date/GP items use the proposed
// value and the player gets needsReview ["birthDate"] / ["wha"] plus a note; WHA<->NHL matches still
// pending are skipped (not added) with a warning; open HR/hockeydb identity items always refuse.
// If reconcile would issue new reserved ids, run `npm run reconcile:wha` first (it records them).
//
// Usage: npm run merge:wha [-- --dry-run] [-- --allow-open]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reconcile, loadReconcileInputs, isWhaReservedId, NEEDS_REVIEW_FIELD, PROVISIONAL_NOTE_PREFIXES } from './reconcile-wha.mjs';
import { validatePlayers } from './validate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLAYERS_FILE = resolve(ROOT, 'site', 'data', 'curated', 'players.json');

/** Open review item kinds that --allow-open may merge provisionally (or skip, for 'nhl'). */
const ALLOW_OPEN_KINDS = new Set(['birthdate', 'gp', 'nhl']);
const MANAGED_REVIEW_FIELDS = Object.values(NEEDS_REVIEW_FIELD);

const collator = new Intl.Collator('en', { sensitivity: 'base' });
export const comparePlayers = (a, b) =>
  collator.compare(a.lastName, b.lastName) || collator.compare(a.firstName, b.firstName) || a.playerId - b.playerId;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Sets obj[key] in place; a new key goes right after `after` (or at the end), keeping key order. */
function setKey(obj, key, value, after = null) {
  if (key in obj || !after || !(after in obj)) {
    obj[key] = value;
    return;
  }
  const entries = Object.entries(obj);
  for (const [k] of entries) delete obj[k];
  for (const [k, v] of entries) {
    obj[k] = v;
    if (k === after) obj[key] = value;
  }
}

/** Renames a key in place, keeping its position. */
function renameKey(obj, from, to) {
  const entries = Object.entries(obj);
  for (const [k] of entries) delete obj[k];
  for (const [k, v] of entries) obj[k === from ? to : k] = v;
}

const isProvisionalNote = (n) => PROVISIONAL_NOTE_PREFIXES.some((p) => n.startsWith(p));

/** Applies one reconcile merge entry to an existing curated record (mutates it). */
function applyWha(p, m) {
  if (p.birthDate !== m.birthDate.value) p.birthDate = m.birthDate.value;
  if (!same(p.wha, m.wha)) setKey(p, 'wha', structuredClone(m.wha), 'nhl');
  if (Array.isArray(p.qualifiedBy) && !p.qualifiedBy.includes('played')) p.qualifiedBy = ['played', ...p.qualifiedBy];

  const review = (p.needsReview ?? []).filter((f) => !MANAGED_REVIEW_FIELDS.includes(f) || m.needsReview.includes(f));
  for (const f of m.needsReview) if (!review.includes(f)) review.push(f);
  if (review.length) { if (!same(p.needsReview, review)) p.needsReview = review; } else delete p.needsReview;

  const notes = (p.notes ?? []).filter((n) => !isProvisionalNote(n) || m.notes.includes(n));
  for (const n of m.notes) if (!notes.includes(n)) notes.push(n);
  if (notes.length) { if (!same(p.notes, notes)) p.notes = notes; } else delete p.notes;
}

/**
 * Pure merge. `players` is not modified.
 * @param {object[]} players curated players.json (v1 or v2)
 * @param {{ report: object, idsChanged: boolean }} reconciled output of reconcile()
 * @returns {{ players: object[], migrated: number, warnings: string[] }}
 */
export function mergeWha(players, { report, idsChanged }, { allowOpen = false } = {}) {
  if (!Array.isArray(players)) throw new Error('merge-wha: players.json must be an array');
  if (idsChanged) {
    throw new Error(`merge-wha: reconcile would issue ${report.ids.added.length} new reserved id(s) (${report.ids.added.map((a) => a.name).join('; ')}); run \`npm run reconcile:wha\` first so they are recorded in data/decisions/wha-ids.json`);
  }
  const open = report.reviewItems;
  const blocking = open.filter((i) => !allowOpen || !ALLOW_OPEN_KINDS.has(i.kind));
  if (blocking.length) {
    const hint = allowOpen ? 'these kinds cannot be merged provisionally' : 'resolve them in data/decisions/wha-decisions.json, or pass --allow-open to merge proposed values marked needsReview';
    throw new Error(`merge-wha: ${blocking.length} review item(s) open (${hint}):\n${blocking.map((i) => `  ${i.id}: ${i.title}`).join('\n')}`);
  }

  const warnings = [];
  let migrated = 0;
  const out = players.map((p) => {
    const c = structuredClone(p);
    if (c.jets !== undefined) {
      if (c.nhl !== undefined) throw new Error(`merge-wha: playerId ${c.playerId} has both jets and nhl`);
      renameKey(c, 'jets', 'nhl');
      migrated++;
    }
    return c;
  });
  const byId = new Map(out.map((p) => [p.playerId, p]));
  const touched = new Set();
  for (const m of report.merge) {
    if (m.action === 'pending-review') {
      warnings.push(`skipped ${m.name}: WHA<->NHL match still pending review (${m.openReviewItems.join(', ')})`);
      continue;
    }
    if (!Number.isInteger(m.playerId)) throw new Error(`merge-wha: ${m.key} has no playerId`);
    if (touched.has(m.playerId)) throw new Error(`merge-wha: playerId ${m.playerId} is targeted twice`);
    touched.add(m.playerId);
    const existing = byId.get(m.playerId);
    if (m.action === 'extend-nhl') {
      if (!existing) throw new Error(`merge-wha: matched NHL player ${m.playerId} (${m.name}) is not in players.json`);
      applyWha(existing, m);
    } else if (m.action === 'new-wha-only') {
      if (!isWhaReservedId(m.playerId)) throw new Error(`merge-wha: WHA-only ${m.key} has non-reserved playerId ${m.playerId}`);
      if (existing) applyWha(existing, m);
      else {
        const rec = structuredClone(m.record);
        out.push(rec);
        byId.set(rec.playerId, rec);
      }
    } else {
      throw new Error(`merge-wha: unknown merge action ${m.action}`);
    }
  }
  for (const p of out) {
    if (p.wha !== undefined && !touched.has(p.playerId)) warnings.push(`playerId ${p.playerId} (${p.name}) has a wha block but no current WHA source record; left unchanged`);
  }
  out.sort(comparePlayers);
  return { players: out, migrated, warnings };
}

const short = (v) => {
  if (v === undefined) return '(absent)';
  const s = JSON.stringify(v);
  return s.length > 140 ? `${s.slice(0, 137)}...` : s;
};

/** Diff-style summary lines (migration jets -> nhl is counted, not listed). */
export function summarize(before, after) {
  const old = new Map(before.map((p) => [p.playerId, p]));
  const lines = [];
  let added = 0;
  let updated = 0;
  for (const p of after) {
    const o = old.get(p.playerId);
    if (!o) {
      added++;
      lines.push(`+ ${p.playerId} ${p.name} (${p.birthDate ?? 'no birthDate'}) WHA ${p.wha ? `${p.wha.regularGP}/${p.wha.playoffGP}` : '-'}${p.needsReview ? ` needsReview ${p.needsReview.join(',')}` : ''}`);
      continue;
    }
    const base = structuredClone(o);
    if (base.jets !== undefined && base.nhl === undefined) renameKey(base, 'jets', 'nhl');
    const keys = [...new Set([...Object.keys(base), ...Object.keys(p)])];
    const changed = keys.filter((k) => !same(base[k], p[k]));
    const reordered = !changed.length && !same(Object.keys(base), Object.keys(p));
    if (!changed.length && !reordered) continue;
    updated++;
    lines.push(`~ ${p.playerId} ${p.name}`);
    for (const k of changed) lines.push(`    ${k}: ${short(base[k])} -> ${short(p[k])}`);
    if (reordered) lines.push('    (key order only)');
  }
  const removed = before.filter((p) => !after.some((q) => q.playerId === p.playerId));
  for (const p of removed) lines.push(`- ${p.playerId} ${p.name}`);
  const orderChanged = !same(before.map((p) => p.playerId), after.filter((p) => old.has(p.playerId)).map((p) => p.playerId));
  return { lines, added, updated, removed: removed.length, orderChanged };
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => !['--dry-run', '--allow-open'].includes(a));
  if (unknown.length) {
    console.error(`Unknown option(s): ${unknown.join(' ')}\nUsage: npm run merge:wha [-- --dry-run] [-- --allow-open]`);
    return 2;
  }
  const dryRun = args.includes('--dry-run');
  const allowOpen = args.includes('--allow-open');

  const text = await readFile(PLAYERS_FILE, 'utf8');
  const before = JSON.parse(text);
  const { idsFileExisted, ...input } = await loadReconcileInputs({ players: before });
  if (!idsFileExisted) throw new Error('merge-wha: data/decisions/wha-ids.json missing; run `npm run reconcile:wha` first');
  if (!input.nhlBirthDates) console.warn('WARNING: temp/reference/nhl-jets.json not found; nhl.com birth dates taken from players.json');
  const reconciled = reconcile(input);
  const { players, migrated, warnings } = mergeWha(before, reconciled, { allowOpen });

  const errors = validatePlayers(players);
  if (errors.length) {
    for (const e of errors) console.error(e);
    throw new Error(`merge-wha: result fails validation (${errors.length} problem(s)); nothing written`);
  }

  const { lines, added, updated, removed, orderChanged } = summarize(before, players);
  for (const l of lines) console.log(l);
  for (const w of warnings) console.warn(`WARNING: ${w}`);
  const provisional = players.filter((p) => p.needsReview?.length);
  if (provisional.length) console.log(`needsReview: ${provisional.map((p) => `${p.name} [${p.needsReview.join(',')}]`).join('; ')}`);
  console.log(`players ${before.length} -> ${players.length}: added ${added}, updated ${updated}, removed ${removed}, migrated jets->nhl ${migrated}${orderChanged ? ', order changed' : ''}; open review items ${reconciled.report.reviewItems.length}`);

  const outText = JSON.stringify(players, null, 2) + '\n';
  if (outText === text) {
    console.log('No changes.');
    return 0;
  }
  if (dryRun) {
    console.log('Dry run: nothing written.');
    return 0;
  }
  await writeFile(PLAYERS_FILE, outText);
  console.log(`Wrote ${PLAYERS_FILE}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }, (err) => { console.error(err.message); process.exitCode = 1; });
}
