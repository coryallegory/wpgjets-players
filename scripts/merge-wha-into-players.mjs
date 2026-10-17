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
//   - WHA-only-for-the-Jets players with an NHL career elsewhere (wha-ids.json retiredFor): the record
//     moves from the reserved id to the real NHL id (key order kept); draft is filled from nhl.com only
//     while null; country changes only by an owner nhlfacts decision
//   - rookieSeason (first major-league regular season, NHL or WHA, any team) is owned here: NHL-layer
//     players take it from temp/reference/nhl-jets.json; WHA players take the earliest of that, the
//     nhl.com lookup, the Hockey-Reference career table and their first WHA Jets regular season
//   - fields owned here: birthDate, wha, qualifiedBy ("played"), rookieSeason, needsReview entries "birthDate"/"wha",
//     generated notes. Everything else is left as is; generated notes are only appended, except
//     "provisional" notes (removed once the review item is resolved) and the "rookieSeason ..." /
//     "nhl.com birthDate ..." notes (replaced when their generated text changes).
//   - one generated note `Name variants: a; b; ...` (see nameVariants; extras from data/decisions/name-variants.json),
//     replaced in place on every run
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
import { reconcile, loadReconcileInputs, isWhaReservedId, NEEDS_REVIEW_FIELD, REGENERATED_NOTE_PREFIXES } from './reconcile-wha.mjs';
import { validatePlayers } from './validate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLAYERS_FILE = resolve(ROOT, 'site', 'data', 'curated', 'players.json');
const NHL_REFERENCE = resolve(ROOT, 'temp', 'reference', 'nhl-jets.json');

/** Open review item kinds that --allow-open may merge provisionally (or skip, for 'nhl'; an open
 *  'nhlid' item leaves the player on the reserved id, an open 'nhlfacts' item keeps the curated value). */
const ALLOW_OPEN_KINDS = new Set(['birthdate', 'gp', 'nhl', 'nhlid', 'nhlfacts']);
const MANAGED_REVIEW_FIELDS = [...Object.values(NEEDS_REVIEW_FIELD), 'country']; // country: nhlfacts items

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

export const NAME_VARIANTS_PREFIX = 'Name variants: ';
const NAME_VARIANTS_FILE = resolve(ROOT, 'data', 'decisions', 'name-variants.json');
const clean = (s) => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ') : '');
const key = (s) => clean(s).toLowerCase();
const codeCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Every other name form seen for one person, as sorted display strings. Sources: Hockey-Reference
 * (name, fullName, nickname) and hockeydb (name, aliases, nickname) records, plus curated extras.
 * Nicknames render as "Nickname" (comma-separated nicknames are split). The player's current
 * primary name is excluded when it matches exactly (ignoring case/spacing); accent-only
 * differences (Sjöberg vs Sjoberg) are kept because they are separate search forms.
 */
export function nameVariants(player, { hr = null, db = null, extra = [] } = {}) {
  const primary = key(`${player.firstName} ${player.lastName}`);
  const seen = new Map();
  const add = (v) => { const c = clean(v); if (c && key(c) !== primary && !seen.has(key(c))) seen.set(key(c), c); };
  for (const r of [hr, db]) {
    if (!r) continue;
    add(r.name);
    add(r.fullName);
    for (const a of r.aliases ?? []) add(a);
    for (const n of String(r.nickname ?? '').split(',')) if (clean(n)) add(`"${clean(n)}"`);
  }
  for (const v of extra) add(v);
  return [...seen.values()].sort(codeCmp);
}

/** Replaces the generated 'Name variants:' note in place (or appends it); other notes untouched. */
function applyNameVariants(p, variants) {
  const notes = p.notes ?? [];
  const i = notes.findIndex((n) => n.startsWith(NAME_VARIANTS_PREFIX));
  const next = variants.length ? `${NAME_VARIANTS_PREFIX}${variants.join('; ')}` : null;
  let out;
  if (i >= 0) out = next ? notes.map((n, j) => (j === i ? next : n)).filter((n, j) => j === i || !n.startsWith(NAME_VARIANTS_PREFIX)) : notes.filter((n) => !n.startsWith(NAME_VARIANTS_PREFIX));
  else out = next ? [...notes, next] : notes;
  if (out.length) { if (!same(p.notes, out)) p.notes = out; } else delete p.notes;
}

const isProvisionalNote = (n) => REGENERATED_NOTE_PREFIXES.some((p) => n.startsWith(p));
const minSeason = (...xs) => xs.filter(Boolean).sort()[0] ?? null;

function setRookie(p, season) {
  if (season !== undefined && p.rookieSeason !== season) p.rookieSeason = season;
}

/**
 * NHL-career fields of a WHA-only-for-the-Jets player now on the real NHL id: rookieSeason (owned
 * here), draft (filled only while null; a different existing draft is kept with a warning), country
 * only by an owner nhlfacts decision.
 */
function applyNhlCareer(p, m, warnings) {
  const target = m.nhlFacts ? m.rookieSeason.season : minSeason(m.rookieSeason.season, p.rookieSeason);
  setRookie(p, target);
  const draft = m.nhlFacts?.draft ?? null;
  if (draft) {
    if (p.draft === null || p.draft === undefined) p.draft = structuredClone(draft);
    else if (!same(p.draft, draft)) warnings.push(`playerId ${p.playerId} (${p.name}): draft differs from nhl.com (${JSON.stringify(draft)}); curated draft kept`);
  }
  if (m.countryOverride && p.country !== m.countryOverride) p.country = m.countryOverride;
}

/** Applies one reconcile merge entry to an existing curated record (mutates it). */
function applyWha(p, m, { keepRookieNote = false } = {}) {
  if (p.birthDate !== m.birthDate.value) p.birthDate = m.birthDate.value;
  if (!same(p.wha, m.wha)) setKey(p, 'wha', structuredClone(m.wha), 'nhl');
  if (Array.isArray(p.qualifiedBy) && !p.qualifiedBy.includes('played')) p.qualifiedBy = ['played', ...p.qualifiedBy];

  const review = (p.needsReview ?? []).filter((f) => !MANAGED_REVIEW_FIELDS.includes(f) || m.needsReview.includes(f));
  for (const f of m.needsReview) if (!review.includes(f)) review.push(f);
  if (review.length) { if (!same(p.needsReview, review)) p.needsReview = review; } else delete p.needsReview;

  const isRookieNote = (n) => n.startsWith('rookieSeason ');
  const generated = keepRookieNote ? m.notes.filter((n) => !isRookieNote(n)) : m.notes;
  const notes = (p.notes ?? []).filter((n) => !isProvisionalNote(n) || generated.includes(n) || (keepRookieNote && isRookieNote(n)));
  for (const n of generated) if (!notes.includes(n)) notes.push(n);
  if (notes.length) { if (!same(p.notes, notes)) p.notes = notes; } else delete p.notes;
}

/**
 * Pure merge. `players` is not modified.
 * @param {object[]} players curated players.json (v1 or v2)
 * @param {{ report: object, idsChanged: boolean }} reconciled output of reconcile()
 * @param {{ allowOpen?: boolean, sources?: { hr: object[], db: object[] }, curatedVariants?: object, nhlRookieSeasons?: Map }} [opts]
 *   `sources` (the HR and hockeydb player lists) enables the generated 'Name variants:' notes;
 *   `curatedVariants` is data/decisions/name-variants.json (entries may use a retired reserved id);
 *   `nhlRookieSeasons` (playerId -> rookieSeason from temp/reference/nhl-jets.json) refreshes rookieSeason
 *   of NHL-layer players; WHA players get the earliest of that and their WHA rookie season.
 * @returns {{ players: object[], migrated: number, warnings: string[], renamed: Map<number, number> }}
 */
export function mergeWha(players, { report, idsChanged }, { allowOpen = false, sources = null, curatedVariants = null, nhlRookieSeasons = null } = {}) {
  if (!Array.isArray(players)) throw new Error('merge-wha: players.json must be an array');
  if (idsChanged) {
    const what = [...report.ids.added.map((a) => `new reserved id for ${a.name}`), ...(report.ids.retiredForNhl ?? []).map((r) => `retire ${r.key} for NHL id ${r.nhlPlayerId}`)];
    throw new Error(`merge-wha: reconcile would change data/decisions/wha-ids.json (${what.join('; ') || 'description'}); run \`npm run reconcile:wha\` first so the ids are recorded`);
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
  const renamed = new Map(); // retired reserved id -> NHL id (this run)
  const retiredToNhl = new Map(report.merge.filter((m) => m.action === 'wha-nhl-career').map((m) => [m.retiredId, m.playerId]));
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
      setRookie(existing, minSeason(nhlRookieSeasons?.has(m.playerId) ? nhlRookieSeasons.get(m.playerId) : existing.rookieSeason, m.rookieSeason?.season));
    } else if (m.action === 'new-wha-only') {
      if (!isWhaReservedId(m.playerId)) throw new Error(`merge-wha: WHA-only ${m.key} has non-reserved playerId ${m.playerId}`);
      if (existing) {
        // Without a whole-career source (HR cache missing) never move a stored rookieSeason later.
        const keep = !m.rookieSeason?.complete && !!existing.rookieSeason && existing.rookieSeason < (m.rookieSeason?.season ?? '9999');
        applyWha(existing, m, { keepRookieNote: keep });
        if (!keep) setRookie(existing, m.rookieSeason?.season ?? null);
      } else {
        const rec = structuredClone(m.record);
        out.push(rec);
        byId.set(rec.playerId, rec);
      }
    } else if (m.action === 'wha-nhl-career') {
      if (isWhaReservedId(m.playerId) || !isWhaReservedId(m.retiredId)) throw new Error(`merge-wha: ${m.key}: bad id pair ${m.retiredId} -> ${m.playerId}`);
      let existing = byId.get(m.playerId);
      const old = byId.get(m.retiredId);
      if (existing && old) throw new Error(`merge-wha: both the retired id ${m.retiredId} and NHL id ${m.playerId} are in players.json (${m.name})`);
      if (existing && existing.source?.site === 'nhl.com') throw new Error(`merge-wha: NHL id ${m.playerId} already belongs to an NHL-layer record; resolve ${m.key} with an nhl: decision instead`);
      if (!existing && old) {
        old.playerId = m.playerId; // playerId is the first key: order kept
        byId.delete(m.retiredId);
        byId.set(m.playerId, old);
        renamed.set(m.retiredId, m.playerId);
        existing = old;
      }
      if (existing) {
        applyWha(existing, m);
        applyNhlCareer(existing, m, warnings);
      } else {
        const rec = structuredClone(m.record);
        out.push(rec);
        byId.set(rec.playerId, rec);
      }
    } else {
      throw new Error(`merge-wha: unknown merge action ${m.action}`);
    }
  }
  if (sources) {
    const hrById = new Map(sources.hr.map((r) => [r.sourceId, r]));
    const dbById = new Map(sources.db.map((r) => [r.sourceId, r]));
    const pairDb = new Map(report.sourceMatching.pairs.map((x) => [x.entityKey, x.dbId]));
    const extras = new Map();
    for (const e of curatedVariants?.variants ?? []) {
      const id = retiredToNhl.get(e.playerId) ?? e.playerId;
      if (!byId.has(id)) throw new Error(`merge-wha: name-variants.json playerId ${e.playerId} is not in players.json`);
      extras.set(id, [...(extras.get(id) ?? []), ...e.variants]);
    }
    for (const m of report.merge) {
      if (m.action === 'pending-review') continue;
      const p = byId.get(m.playerId);
      const [kind, id] = [m.key.slice(0, 2), m.key.slice(3)];
      const hr = kind === 'hr' ? hrById.get(id) : null;
      const db = kind === 'db' ? dbById.get(id) : dbById.get(pairDb.get(m.key));
      applyNameVariants(p, nameVariants(p, { hr, db, extra: extras.get(p.playerId) }));
    }
    for (const id of extras.keys()) if (!byId.get(id).wha) warnings.push(`name-variants.json playerId ${id} has no wha block; its variants were not applied`);
  }
  // rookieSeason of NHL-layer players without a WHA source record: nhl.com (first NHL or WHA regular season).
  if (nhlRookieSeasons) {
    for (const p of out) if (!touched.has(p.playerId) && nhlRookieSeasons.has(p.playerId)) setRookie(p, nhlRookieSeasons.get(p.playerId));
  }
  for (const p of out) {
    if (p.wha !== undefined && !touched.has(p.playerId)) warnings.push(`playerId ${p.playerId} (${p.name}) has a wha block but no current WHA source record; left unchanged`);
  }
  out.sort(comparePlayers);
  return { players: out, migrated, warnings, renamed };
}

const short = (v) => {
  if (v === undefined) return '(absent)';
  const s = JSON.stringify(v);
  return s.length > 140 ? `${s.slice(0, 137)}...` : s;
};

/** Diff-style summary lines (migration jets -> nhl is counted, not listed). */
export function summarize(before, after, renamed = new Map()) {
  const old = new Map(before.map((p) => [renamed.get(p.playerId) ?? p.playerId, p]));
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
    lines.push(`~ ${p.playerId} ${p.name}${o.playerId !== p.playerId ? ` (was ${o.playerId})` : ''}`);
    for (const k of changed) lines.push(`    ${k}: ${short(base[k])} -> ${short(p[k])}`);
    if (reordered) lines.push('    (key order only)');
  }
  const removed = before.filter((p) => !after.some((q) => q.playerId === (renamed.get(p.playerId) ?? p.playerId)));
  for (const p of removed) lines.push(`- ${p.playerId} ${p.name}`);
  const orderChanged = !same(before.map((p) => renamed.get(p.playerId) ?? p.playerId), after.filter((p) => old.has(p.playerId)).map((p) => p.playerId));
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
  const curatedVariants = JSON.parse(await readFile(NAME_VARIANTS_FILE, 'utf8').catch(() => '{"variants":[]}'));
  const nhlRookieSeasons = await readFile(NHL_REFERENCE, 'utf8').then((t) => new Map(JSON.parse(t).players.map((p) => [p.playerId, p.rookieSeason ?? null])), () => null);
  if (!nhlRookieSeasons) console.warn('WARNING: temp/reference/nhl-jets.json not found; rookieSeason of NHL-layer players left as is');
  if (!input.nhlLookup) console.warn('WARNING: temp/reference/nhl-wha-lookup.json not found; NHL ids already in wha-ids.json are used, their draft/rookieSeason left as is');
  const { players, migrated, warnings, renamed } = mergeWha(before, reconciled, { allowOpen, sources: { hr: input.hr.players, db: input.db.players }, curatedVariants, nhlRookieSeasons });

  const errors = validatePlayers(players);
  if (errors.length) {
    for (const e of errors) console.error(e);
    throw new Error(`merge-wha: result fails validation (${errors.length} problem(s)); nothing written`);
  }

  const { lines, added, updated, removed, orderChanged } = summarize(before, players, renamed);
  for (const [from, to] of renamed) console.log(`playerId ${from} -> ${to} (reserved WHA-only id retired; nhl.com id)`);
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
