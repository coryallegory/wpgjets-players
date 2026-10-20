// Builds site/data/curated/cards.json from decided cards only. Dry run by default; --apply writes.
// Usage: npm run import:cards [-- --apply] [--decisions <dir>] [--baseline <file>]
//
// Sources of decisions (see docs/pipeline.md):
//   (a) data/decisions/young-guns-verified.json   owner-verified Young Guns   basis owner-verified-young-guns
//   (b) Hull and Selanne in temp/reference/cards-baseline.json (owner confirmed) basis owner-confirmed
//   (c) review page decisions, a local export of the artifact db 'decisions' collection
//       (default dir temp/review/decisions/, any *.json below it)             basis page-approval
// Undecided players get no record. An existing record that would change is listed and only written
// with --apply; records not produced by any source are left alone. Conflicts (two sources disagree
// for one player) are reported and never written.

import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isValidIsoDate } from './validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CARDS_FILE = path.join(ROOT, 'site', 'data', 'curated', 'cards.json');
const PLAYERS_FILE = path.join(ROOT, 'site', 'data', 'curated', 'players.json');
const YG_FILE = path.join(ROOT, 'data', 'decisions', 'young-guns-verified.json');
const BASELINE_FILE = path.join(ROOT, 'temp', 'reference', 'cards-baseline.json');
const DECISIONS_DIR = path.join(ROOT, 'temp', 'review', 'decisions');

/** Owner-confirmed outside the page (docs/cards.md, pilot review decisions 2026-10-18). */
export const OWNER_CONFIRMED = [
  { playerId: 8448108, decidedOn: '2026-10-18' }, // Hull, 1958-59 Topps #66
  { playerId: 8457981, decidedOn: '2026-10-18' }, // Selanne, 1991-92 Upper Deck #21
];

const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== ''));
const hasGames = (p) => (p.nhl?.regularGP ?? 0) + (p.nhl?.playoffGP ?? 0) + (p.wha?.regularGP ?? 0) + (p.wha?.playoffGP ?? 0) > 0;

/** Chosen-card object of a record from a baseline candidate (reference links only, no prices/images). */
export function cardFromCandidate(c, overrides = {}) {
  const urls = clean({ scp: c.url, comc: c.comcUrl });
  const sourceIds = clean({ scp: c.sourceIds?.scp, comc: c.sourceIds?.comc });
  return clean({
    set: c.set,
    year: c.scpYear ? Number(c.scpYear) : null,
    season: c.season,
    brand: c.brand,
    subset: c.subset,
    cardNumber: c.cardNumber === null || c.cardNumber === undefined ? null : String(c.cardNumber),
    serialNumbered: c.serialNumbered,
    variant: c.variant,
    sourceIds: Object.keys(sourceIds).length ? sourceIds : null,
    urls: Object.keys(urls).length ? urls : null,
    ...overrides,
  });
}

const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => Number(a) - Number(b)));

/**
 * Pure builder. Returns { desired: Map(playerId -> record), conflicts: [], warnings: [] }.
 * inputs: { players, baseline (records[]), yg (decisions[]), pageDecisions[] }.
 */
export function buildDesired({ players, baseline, yg, pageDecisions }) {
  const playerMap = new Map(players.map((p) => [p.playerId, p]));
  const base = new Map(baseline.map((r) => [r.playerId, r]));
  const desired = new Map();
  const conflicts = [];
  const warnings = [];

  const propose = (playerId, record, label) => {
    const p = playerMap.get(playerId);
    if (!p) return warnings.push(`${label}: playerId ${playerId} is not in players.json, skipped`);
    if (!hasGames(p)) return warnings.push(`${label}: ${p.name} never played (no card record), skipped`);
    const prev = desired.get(playerId);
    if (prev) {
      // Same card from two sources is fine; a different card is a conflict.
      const a = JSON.stringify([prev.status, prev.chosen?.set, prev.chosen?.cardNumber]);
      const b = JSON.stringify([record.status, record.chosen?.set, record.chosen?.cardNumber]);
      if (a !== b) conflicts.push(`${p.name} (${playerId}): ${label} disagrees with ${prev.basis} (${prev.chosen?.set ?? prev.status} ${prev.chosen?.cardNumber ?? ''})`);
      return;
    }
    desired.set(playerId, record);
  };

  // (a) owner-verified Young Guns
  for (const d of yg) {
    const r = base.get(d.playerId);
    const cand = r?.candidates?.find((c) => c.verified && String(c.cardNumber) === String(d.cardNumber));
    if (!cand) {
      if (playerMap.get(d.playerId) && hasGames(playerMap.get(d.playerId))) warnings.push(`young-guns-verified: no baseline candidate for ${d.name}, skipped`);
      else propose(d.playerId, null, 'young-guns-verified');
      continue;
    }
    if (cand.season !== d.season) warnings.push(`young-guns-verified: ${d.name} season ${d.season} differs from baseline ${cand.season}`);
    propose(d.playerId, {
      status: 'chosen',
      chosen: cardFromCandidate(cand, { season: d.season, subset: 'Young Guns' }),
      rule: 'verified-young-guns',
      confidence: 'high',
      source: d.source ?? 'owner collection records',
      checkedOn: r.checkedOn,
      decidedOn: d.date,
      decidedBy: 'owner',
      basis: 'owner-verified-young-guns',
    }, 'young-guns-verified');
  }

  // (b) owner-confirmed Hull / Selanne
  for (const o of OWNER_CONFIRMED) {
    const r = base.get(o.playerId);
    if (!r?.chosen) { warnings.push(`owner-confirmed: no baseline chosen card for ${o.playerId}`); continue; }
    propose(o.playerId, clean({
      status: 'chosen',
      chosen: cardFromCandidate(r.chosen),
      rule: r.rule,
      confidence: 'high',
      source: r.source,
      checkedOn: r.checkedOn,
      decidedOn: o.decidedOn,
      decidedBy: 'owner',
      basis: 'owner-confirmed',
      note: r.reason,
    }), 'owner-confirmed');
  }

  // (c) review page decisions
  for (const d of pageDecisions) {
    if (d.action !== 'approve' && d.action !== 'no-card') continue; // 'none' = a note only, no decision
    const p = playerMap.get(d.playerId);
    const label = `page decision ${d.name ?? d.playerId}`;
    if (!p) { warnings.push(`${label}: not in players.json, skipped`); continue; }
    const decidedOn = String(d.decidedAt ?? '').slice(0, 10);
    if (!isValidIsoDate(decidedOn)) { warnings.push(`${label}: bad decidedAt ${JSON.stringify(d.decidedAt)}, skipped`); continue; }
    const r = base.get(d.playerId);
    const common = { decidedOn, decidedBy: 'owner', basis: 'page-approval', ...(d.note ? { note: String(d.note).trim() } : {}) };
    if (d.action === 'no-card') {
      propose(d.playerId, clean({
        status: 'no-card', chosen: null, rule: r?.rule, confidence: r?.confidence, source: r?.source ?? 'owner review page',
        checkedOn: r?.checkedOn, reason: r?.reason, ...common,
      }), label);
      continue;
    }
    const cand = (r?.candidates ?? []).find((c) =>
      (d.scpId && (c.sourceIds?.scp === d.scpId || c.sourceIds?.comc === d.scpId))
      || (d.comcUrl && c.comcUrl === d.comcUrl) || (d.url && c.url === d.url));
    if (!cand) { warnings.push(`${label}: approved card (${d.set} #${d.cardNumber}) not found among baseline candidates, skipped`); continue; }
    propose(d.playerId, clean({
      status: 'chosen', chosen: cardFromCandidate(cand), rule: r.rule, confidence: cand.confidence, source: r.source,
      checkedOn: r.checkedOn, ...common,
    }), label);
  }

  return { desired, conflicts, warnings };
}

/** Compares desired with existing cards. Existing records absent from desired are kept untouched. */
export function diffCards(existing, desired) {
  const added = [];
  const changed = [];
  const same = [];
  const result = { ...existing };
  for (const [id, rec] of desired) {
    const prev = existing[id];
    if (!prev) added.push(id);
    else if (JSON.stringify(prev) !== JSON.stringify(rec)) changed.push(id);
    else same.push(id);
    result[id] = rec;
  }
  return { added, changed, same, result: sortKeys(result) };
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw err;
  }
}

async function listJson(dir) {
  const out = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch (err) { if (err.code === 'ENOENT') return out; throw err; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listJson(full)));
    else if (e.name.endsWith('.json')) out.push(full);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
  const baselineFile = opt('--baseline', BASELINE_FILE);
  const decisionsDir = opt('--decisions', DECISIONS_DIR);

  const players = await readJson(PLAYERS_FILE);
  const baselineJson = await readJson(baselineFile, null);
  if (!baselineJson) {
    console.error(`${path.relative(ROOT, baselineFile)} not found: rebuild it first (get-cards-baseline-build.mjs). Nothing imported.`);
    return 1;
  }
  const yg = (await readJson(YG_FILE, { decisions: [] })).decisions;
  const files = await listJson(decisionsDir);
  const pageDecisions = [];
  for (const f of files) pageDecisions.push(await readJson(f));
  if (files.length === 0) console.log(`Notice: no review page decisions under ${path.relative(ROOT, decisionsDir)} (export the artifact 'decisions' collection first).`);

  const { desired, conflicts, warnings } = buildDesired({ players, baseline: baselineJson.records, yg, pageDecisions });
  const existing = await readJson(CARDS_FILE, {});
  const { added, changed, same, result } = diffCards(existing, desired);

  const nameOf = (id) => players.find((p) => p.playerId === Number(id))?.name ?? id;
  const byBasis = {};
  for (const r of Object.values(result)) byBasis[r.basis] = (byBasis[r.basis] ?? 0) + 1;
  console.log(`Decisions read: ${yg.length} verified Young Guns, ${OWNER_CONFIRMED.length} owner-confirmed, ${pageDecisions.length} page docs (${pageDecisions.filter((d) => d.action === 'approve' || d.action === 'no-card').length} decided).`);
  console.log(`ADDED ${added.length}, CHANGED ${changed.length}, unchanged ${same.length}.`);
  for (const id of added.filter((i) => desired.get(Number(i)).basis !== 'owner-verified-young-guns')) {
    const r = desired.get(Number(id));
    console.log(`  + ${nameOf(id)} [${r.basis}] ${r.chosen ? `${r.chosen.set} #${r.chosen.cardNumber}` : 'no card'}`);
  }
  for (const id of changed) {
    console.log(`  ~ CHANGE ${nameOf(id)}\n      was: ${JSON.stringify(existing[id])}\n      now: ${JSON.stringify(desired.get(Number(id)))}`);
  }
  for (const w of warnings) console.log(`  warning: ${w}`);
  for (const c of conflicts) console.log(`  CONFLICT (not written): ${c}`);
  console.log(`Records after import by basis: ${JSON.stringify(byBasis)} (total ${Object.keys(result).length}).`);

  if (!apply) {
    console.log('Dry run: nothing written. Re-run with --apply to write cards.json.');
    return 0;
  }
  if (added.length + changed.length === 0) {
    console.log('No changes.');
    return 0;
  }
  await writeFile(CARDS_FILE, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, CARDS_FILE)}. Run npm run validate.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
