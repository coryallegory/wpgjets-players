#!/usr/bin/env node
// Phase 2 baseline, step 1: gather SCP rows for every target player (resumable: results are appended
// to temp/cache/scp-baseline/gather.jsonl and skipped on restart; HTTP responses are cached too).
import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT, loadTargets, gather } from './cards-baseline-lib.mjs';

const OUT = resolve(ROOT, 'temp/cache/scp-baseline/gather.jsonl');
await mkdir(resolve(ROOT, 'temp/cache/scp-baseline'), { recursive: true });
const done = new Set();
try { for (const l of (await readFile(OUT, 'utf8')).split('\n')) if (l) done.add(JSON.parse(l).playerId); } catch {}
const targets = await loadTargets();
const t0 = Date.now();
let i = 0, reqs = 0;
for (const p of targets) {
  i++;
  if (done.has(p.playerId)) continue;
  try {
    const g = await gather(p);
    reqs += g.queries.filter((q) => !q.cached).length;
    await appendFile(OUT, JSON.stringify({ playerId: p.playerId, ...g }) + '\n');
    console.log(`${i}/${targets.length} ${p.name} rows=${g.rows.length} q=${g.queries.length} ${((Date.now() - t0) / 60000).toFixed(1)}min reqs=${reqs}`);
  } catch (e) {
    console.log(`${i}/${targets.length} ${p.name} ERROR ${e.message}`);
  }
}
console.log('DONE');
