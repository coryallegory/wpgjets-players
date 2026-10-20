#!/usr/bin/env node
// Phase 2 baseline, step 1c: SCP search returns at most 100 rows, so famous players lose their early
// cards. For players whose name searches were truncated and whose decision is not yet high-confidence,
// re-query with year + brand tokens ("name 2013 Upper Deck", works for modern years).
// gather2.jsonl -> gather3.jsonl (resumable).
import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { searchScp } from './get-cards-scp.mjs';
import { ROOT, loadTargets, startYear, nameVariants, matchRowCompat, parsePlayerText, fold } from './cards-baseline-lib.mjs';

const dir = resolve(ROOT, 'temp/cache/scp-baseline');
const read = async (f) => { try { return (await readFile(resolve(dir, f), 'utf8')).split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
const prev = new Map((await read('gather2.jsonl')).map((g) => [g.playerId, g]));
const done = new Set((await read('gather3.jsonl')).map((g) => g.playerId));
const baseline = new Map(JSON.parse(await readFile(resolve(ROOT, 'temp/reference/cards-baseline.json'), 'utf8')).records.map((r) => [r.playerId, r]));
const targets = await loadTargets();
const t0 = Date.now();
let i = 0;
for (const p of targets) {
  i++;
  const g = prev.get(p.playerId);
  const rec = baseline.get(p.playerId);
  if (!g || done.has(p.playerId)) continue;
  const truncated = g.queries.some((q) => q.truncated && q.n >= 100);
  if (!truncated || g.rows.length === 0 || rec.confidence === 'high') {
    await appendFile(resolve(dir, 'gather3.jsonl'), JSON.stringify({ ...g, extra: [] }) + '\n');
    continue;
  }
  const y = startYear(p);
  // most common first-name form in the matched rows
  const cnt = new Map();
  for (const r of g.rows) { const n = parsePlayerText(r.player).names[0]; if (n) cnt.set(n.split(' ')[0], (cnt.get(n.split(' ')[0]) ?? 0) + 1); }
  const form = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fold(p.firstName);
  const firsts = [...new Set([...nameVariants(p), form])];
  const brands = y >= 2003 ? ['Upper Deck'] : y >= 1990 ? ['Upper Deck', 'O-Pee-Chee'] : y >= 1968 ? ['O-Pee-Chee'] : ['Topps', 'Parkhurst', 'O-Pee-Chee'];
  const seen = new Map(g.rows.map((r) => [r.id, r]));
  const extra = [];
  for (const yr of [y, y + 1]) for (const b of brands) {
    const q = `${form} ${fold(p.lastName)} ${yr} ${b}`;
    const r = await searchScp(q);
    extra.push({ q, n: r.rows.length, truncated: r.truncated, cached: r.cached });
    for (const row of r.rows) if (!seen.has(row.id) && matchRowCompat(row, firsts, p.lastName)) seen.set(row.id, { ...row, multi: false, via: 'year-query' });
  }
  await appendFile(resolve(dir, 'gather3.jsonl'), JSON.stringify({ ...g, rows: [...seen.values()], queries: [...g.queries, ...extra], extra }) + '\n');
  console.log(`${i}/${targets.length} ${p.name} +${seen.size - g.rows.length} rows ${((Date.now() - t0) / 60000).toFixed(1)}min`);
}
console.log('DONE');
