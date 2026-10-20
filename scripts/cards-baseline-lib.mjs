// Shared helpers for the phase 2 baseline (uncommitted): target selection, name matching, gather.
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchScp } from './get-cards-scp.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const fold = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ø/gi, 'o').replace(/æ/gi, 'ae').replace(/ß/g, 'ss')
    .replace(/đ/gi, 'd').replace(/ł/gi, 'l').toLowerCase().replace(/[.'’`]/g, '').replace(/[-]/g, ' ').replace(/\s+/g, ' ').trim();

export async function loadTargets() {
  const all = JSON.parse(await readFile(resolve(ROOT, 'site/data/curated/players.json'), 'utf8'));
  return all.filter((p) => (p.nhl.regularGP + p.nhl.playoffGP) > 0 || (p.wha && p.wha.seasons && p.wha.seasons.length > 0));
}

export const startYear = (p) => (p.rookieSeason ? +p.rookieSeason.slice(0, 4) : null);
export const isWhaOnly = (p) => p.playerId >= 900000 && p.playerId < 1000000;

/** Alternate first names from "Name variants:" notes (e.g. "Michael Anthony Amodeo" -> Michael). */
export function nameVariants(p) {
  const out = new Set([p.firstName]);
  for (const n of p.notes ?? []) {
    const m = n.match(/^Name variants: (.*)$/);
    if (!m) continue;
    for (const v of m[1].split(';').map((s) => s.trim())) {
      if (!v || v.startsWith('"')) continue;
      const parts = v.split(/\s+/);
      if (fold(parts[parts.length - 1]) === fold(p.lastName) && parts.length >= 2) out.add(parts[0]);
    }
  }
  return [...out];
}

/** Parse a title's player part: { names:[...], variant } */
export function parsePlayerText(playerText) {
  let t = playerText;
  let variant = null;
  const b = t.match(/\[([^\]]*)\]/);
  if (b) { variant = b[1]; t = t.replace(/\[[^\]]*\]/g, ' '); }
  t = t.replace(/\s+(French|Canadian)$/i, (m, w) => { variant = variant ?? w; return ''; }).trim();
  const names = t.split(/\s*,\s*|\s+\/\s+|\s+&\s+/).map((s) => fold(s.replace(/\b(jr|sr|ii|iii)\b/gi, ''))).filter(Boolean);
  return { names, variant };
}

export function matchRow(row, first, last) {
  const { names, variant } = parsePlayerText(row.player);
  const full = fold(first + ' ' + last);
  return { hit: names.length === 1 && names[0] === full, multi: names.length > 1 && names.includes(full), variant };
}

/** Gather all SCP rows for a player; returns { queries:[{q,n,truncated}], rows:[exact-name rows] , fallback } */
export async function gather(p, log = () => {}) {
  const variants = nameVariants(p);
  const seen = new Map();
  const queries = [];
  const y = startYear(p);
  const wha = !!(p.wha && p.wha.seasons.length);
  const doQuery = async (q) => {
    const r = await searchScp(q);
    queries.push({ q, n: r.rows.length, truncated: r.truncated, cached: r.cached });
    let hits = 0;
    for (const row of r.rows) {
      for (const f of variants) {
        const m = matchRow(row, f, p.lastName);
        const m2 = matchRow(row, f, p.lastName);
        if (m.hit || m2.multi) { if (!seen.has(row.id)) seen.set(row.id, { ...row, multi: !m.hit, matchedFirst: f }); hits++; break; }
      }
    }
    return { r, hits };
  };
  const base = `${p.firstName} ${p.lastName}`;
  const qf = (s) => fold(s).replace(/\s+/g, ' ');
  let { r } = await doQuery(qf(base));
  const brands = [];
  if (r.truncated) {
    if (y == null || y < 2005 || y >= 1968) brands.push('O-Pee-Chee');
    if (y < 1990) brands.push('Topps');
    if (y >= 1989) brands.push('Upper Deck');
    if (y < 1965) brands.push('Parkhurst');
    if (y >= 1990 && y < 2004) brands.push('Parkhurst');
    for (const b of brands) await doQuery(`${qf(base)} ${b}`);
  }
  if (wha && (y == null || y < 1980)) await doQuery(`${qf(base)} WHA`);
  if (![...seen.values()].some((x) => !x.multi)) {
    for (const f of variants.slice(1)) await doQuery(qf(`${f} ${p.lastName}`));
  }
  let fallback = false;
  if (![...seen.values()].some((x) => !x.multi)) {
    // last name only, same first initial
    const { r: r2 } = await doQuery(qf(p.lastName));
    for (const row of r2.rows) {
      const { names } = parsePlayerText(row.player);
      if (names.length === 1) {
        const parts = names[0].split(' ');
        if (parts[parts.length - 1] === fold(p.lastName) && parts[0][0] === fold(p.firstName)[0]) {
          fallback = true;
          if (!seen.has(row.id)) seen.set(row.id, { ...row, multi: false, fallbackName: names[0] });
        }
      }
    }
  }
  return { queries, rows: [...seen.values()], fallback };
}

// ---- second pass: nickname-aware matching (SCP often uses Gabe/Nicolas/Mike style names) ----
const GROUPS = [
  'mike michael mickey', 'matt matthew', 'nick nic nicolas nicholas nicklas niklas', 'alex alexander alexandre alexei alexey aleksandr',
  'ben benjamin benny', 'dave david', 'dan danny daniel', 'bob bobby rob robby robert robbie', 'bill billy will william willie',
  'jim jimmy james jamie', 'joe joey joseph', 'tom tommy thomas', 'steve steven stephen stephane', 'chris christopher kris', 'tony anthony',
  'andy andrew andre', 'ed eddie edward eddy', 'greg gregory', 'jeff jeffrey geoff geoffrey', 'jon jonathan jonny', 'pat patrick patty',
  'rick richard ricky rich dick', 'ron ronald ronnie', 'tim timothy', 'toby tobias', 'zach zack zachary zachery', 'sam samuel',
  'josh joshua', 'nate nathan nathaniel', 'jake jacob', 'ken kenneth kenny', 'larry lawrence', 'don donald donnie', 'doug douglas',
  'fred frederick freddie', 'gord gordon gordie', 'jerry gerald gerry jerome', 'jack john johnny jon', 'jay jason', 'kevin kev', 'mark marc marcus',
  'pete peter', 'phil philip phillip', 'ray raymond', 'russ russell', 'ted theodore edward', 'terry terrence terence', 'vic victor',
  'walt walter wally', 'wes wesley', 'tyler ty', 'cam cameron', 'drew andrew', 'eric erik', 'jake jacob', 'johan johannes', 'jonas jon',
  'lou louis', 'ty tyler', 'josh joshua', 'max maxim maxime', 'phil philippe', 'fran francois frank francis', 'jean john', 'sergei sergey serge',
  'dmitri dmitry dmitri', 'evgeni evgeny eugene', 'vladimir vlad', 'mikael mikko mika', 'dale dalton', 'dennis denis', 'gabe gabriel',
  'gerard gerry gerald', 'harold harry', 'henry hank harry', 'jason jay', 'jeremy jerry', 'kyle', 'lance', 'leo leonard len lenny', 'norm norman',
  'randy randall', 'reg reginald reggie', 'roger rodger', 'ross', 'scott scotty', 'stu stuart stewart', 'tod todd', 'trevor trev', 'bryan brian bryant',
];
const aliasMap = new Map();
for (const g of GROUPS) { const ws = g.split(' '); for (const w of ws) { if (!aliasMap.has(w)) aliasMap.set(w, new Set()); ws.forEach((x) => aliasMap.get(w).add(x)); } }
export const aliasesOf = (first) => [...(aliasMap.get(fold(first)) ?? [])].filter((x) => x !== fold(first));
export function firstCompat(a, b) {
  a = fold(a); b = fold(b);
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  return aliasMap.get(a)?.has(b) ?? false;
}
/** Single-name row whose surname matches and whose first name is compatible with any of the firsts. */
export function matchRowCompat(row, firsts, last) {
  const { names } = parsePlayerText(row.player);
  if (names.length !== 1) return false;
  const parts = names[0].split(' ');
  if (parts.length < 2 || parts.slice(1).join(' ') !== fold(last)) return false;
  return firsts.some((f) => firstCompat(parts[0], f));
}
export async function gatherMore(p, prev) {
  const y = startYear(p);
  const firsts = nameVariants(p);
  const seen = new Map(prev.rows.map((r) => [r.id, r]));
  const queries = [];
  const qf = (s) => fold(s);
  const run = async (q) => {
    const r = await searchScp(q);
    queries.push({ q, n: r.rows.length, truncated: r.truncated, cached: r.cached });
    for (const row of r.rows) if (!seen.has(row.id) && matchRowCompat(row, firsts, p.lastName)) seen.set(row.id, { ...row, multi: false, via: 'alias' });
    return r;
  };
  const tried = new Set([...prev.queries.map((q) => q.q), ...firsts.map((f) => qf(`${f} ${p.lastName}`))]);
  const alts = new Set();
  for (const f of firsts) for (const a of aliasesOf(f)) alts.add(a);
  for (const a of alts) {
    const q = qf(`${a} ${p.lastName}`);
    if (tried.has(q)) continue;
    tried.add(q);
    const r = await run(q);
    if (r.truncated) {
      const brands = [];
      if (y == null || y >= 1968) brands.push('O-Pee-Chee');
      if (y < 1990) brands.push('Topps');
      if (y >= 1989) brands.push('Upper Deck');
      if (y < 1965) brands.push('Parkhurst');
      for (const b of brands) await run(`${q} ${b}`);
    }
  }
  const have = [...seen.values()].some((r) => { const m = r.set.match(/^(\d{4})\s+(O[- ]Pee[- ]Chee|Topps|Parkhurst|Upper Deck)/i); return m && !r.multi && +m[1] >= (y ?? 1900) - 1 && +m[1] <= (y ?? 3000) + 1; });
  if (!have && !tried.has(qf(p.lastName))) await run(qf(p.lastName));
  return { queries: [...prev.queries, ...queries], rows: [...seen.values()], fallback: prev.fallback };
}
