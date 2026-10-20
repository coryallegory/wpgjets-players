#!/usr/bin/env node
// Phase 2 wide search, step 1: crawl whole SportsCardsPro set pages (consoles) for the relevant card families
// (O-Pee-Chee, Topps, Parkhurst, Upper Deck family incl. Rookie Class, SP/SP Authentic, Victory, MVP, Ice, Artifacts, ...)
// in every season window where a non-locked player's rookie cards could be. Resumable: one line per finished set in
// temp/cache/scp-wide/index.jsonl; HTTP pages are cached too (2.5s delay, curl, browser UA via get-cards-scp.mjs).
// Slug lists: temp/cache/scp-wide/slugs-all.txt (SCP brand pages + set slugs seen in cached search results).
import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { consolePage } from './get-cards-scp.mjs';
import { ROOT, loadTargets, startYear } from './cards-baseline-lib.mjs';
import { classifySlug } from './cards-wide-sets.mjs';

export const RELEASE_DATE = '2026-10-17'; // fixed so cached pages are reused
const DIR = resolve(ROOT, 'temp/cache/scp-wide');
const OUT = resolve(DIR, 'index.jsonl');
await mkdir(DIR, { recursive: true });
const verified = new Set(JSON.parse(await readFile(resolve(ROOT, 'data/decisions/young-guns-verified.json'), 'utf8')).decisions.map((d) => d.playerId));
const targets = (await loadTargets()).filter((p) => !verified.has(p.playerId));
const need = new Set();
for (const p of targets) { const y = startYear(p); for (let k = y - 1; k <= y + 3; k++) need.add(k); }
const slugs = (await readFile(resolve(DIR, 'slugs-all.txt'), 'utf8')).split('\n').filter(Boolean);
const OLD_OK = new Set(['opc', 'opcp', 'opcx', 'topps', 'parkhurst']);
const prio = { ud: 0, udrookie: 0, opc: 1, opcp: 1, opcx: 1, topps: 2, parkhurst: 2, udother: 3, sp: 3, mainstream: 4, toppsp: 4, premium: 5 };
const plan = slugs.map((s) => ({ s, c: classifySlug(s) })).filter(({ c }) => c && need.has(c.year) && c.year >= 1967 && (c.year >= 1989 || OLD_OK.has(c.kind)) && (c.tier !== 'premium' || c.year >= 1993))
  .sort((a, b) => (a.c.year >= 2019) - (b.c.year >= 2019) || prio[a.c.kind] - prio[b.c.kind] || b.c.year - a.c.year);
const done = new Set();
try { for (const l of (await readFile(OUT, 'utf8')).split('\n')) if (l) done.add(JSON.parse(l).slug); } catch {}
console.log(`sets planned ${plan.length}, done ${done.size}`);
if (process.argv.includes('--plan')) process.exit(0);
let pages = 0, i = 0;
for (const { s } of plan) {
  i++;
  if (done.has(s)) continue;
  try {
    const rows = [];
    let setName = '';
    for (let cursor = 0; ; cursor += 150) {
      const r = await consolePage(s.replace(/&amp;/g, '&'), cursor, RELEASE_DATE);
      pages++; setName = r.setName; rows.push(...r.rows);
      if (!r.hasMore || r.rows.length === 0) break;
    }
    await appendFile(OUT, JSON.stringify({ slug: s, setName, rows }) + '\n');
    console.log(`${i}/${plan.length} ${s} rows=${rows.length} pagesTotal=${pages}`);
  } catch (e) { console.log(`${i}/${plan.length} ${s} ERROR ${e.message}`); }
}
console.log('DONE');
