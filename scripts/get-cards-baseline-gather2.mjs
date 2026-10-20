#!/usr/bin/env node
// Phase 2 baseline, step 1b: nickname-aware second pass over gather.jsonl -> gather2.jsonl (resumable).
import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT, loadTargets, gatherMore } from './cards-baseline-lib.mjs';

const IN = resolve(ROOT, 'temp/cache/scp-baseline/gather.jsonl');
const OUT = resolve(ROOT, 'temp/cache/scp-baseline/gather2.jsonl');
const prev = new Map();
for (const l of (await readFile(IN, 'utf8')).split('\n')) if (l) { const g = JSON.parse(l); prev.set(g.playerId, g); }
const done = new Set();
try { for (const l of (await readFile(OUT, 'utf8')).split('\n')) if (l) done.add(JSON.parse(l).playerId); } catch {}
const targets = await loadTargets();
const t0 = Date.now();
let i = 0;
for (const p of targets) {
  i++;
  if (done.has(p.playerId)) continue;
  try {
    const g = await gatherMore(p, prev.get(p.playerId));
    const added = g.rows.length - prev.get(p.playerId).rows.length;
    await appendFile(OUT, JSON.stringify({ playerId: p.playerId, ...g }) + '\n');
    console.log(`${i}/${targets.length} ${p.name} +${added} rows q=${g.queries.length} ${((Date.now() - t0) / 60000).toFixed(1)}min`);
  } catch (e) { console.log(`${i}/${targets.length} ${p.name} ERROR ${e.message}`); }
}
console.log('DONE');
