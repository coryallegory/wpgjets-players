#!/usr/bin/env node
// Collects every player who appeared in >=1 regular-season or playoff game for the
// WHA Winnipeg Jets (1972-73..1978-79) from Hockey-Reference (team code WNJ).
// Preseason is never counted. WHA draft picks are out of scope.
// Output: temp/reference/hockeyreference-wha-jets.json (reference data, never hand-edit).
// Usage: node scripts/wha/get-hockeyreference-wha.mjs [--refresh] [--no-players]
// Politeness: descriptive UA, sequential requests >=3.2s apart, every page cached in
// temp/cache/hockeyreference/ (reused unless --refresh), STOP on 403.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE_DIR = resolve(ROOT, 'temp', 'cache', 'hockeyreference');
const OUT = resolve(ROOT, 'temp', 'reference', 'hockeyreference-wha-jets.json');
const BASE = 'https://www.hockey-reference.com';
const TEAM_URL = (endYear) => `${BASE}/teams/WNJ/${endYear}.html`;
const PLAYER_URL = (id) => `${BASE}/players/${id[0]}/${id}.html`;
const END_YEARS = [1973, 1974, 1975, 1976, 1977, 1978, 1979];
const DELAY_MS = 3200;
const RETRIES = 4;
const USER_AGENT = 'wpgjets-players-tracker/1.0 (personal one-time data pull; contact corymetcalfe@gmail.com)';

// ---------------------------------------------------------------- pure helpers

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', bull: '•' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

/** Table ids are often inside HTML comments; un-comment so one scan finds them all. */
export function uncomment(html) {
  return html.replace(/<!--([\s\S]*?)-->/g, (m, inner) => (/<table[\s>]/i.test(inner) ? inner : m));
}

/** Returns the inner HTML of <table ... id="id"> ... </table>, or null. */
export function extractTable(html, id) {
  const re = new RegExp(`<table\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</table>`, 'i');
  const m = uncomment(html).match(re);
  return m ? m[1] : null;
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'));
  return m ? decodeEntities(m[1]) : null;
}

/**
 * Parses table HTML into rows of { stat: { text, href, id, csk } } keyed by data-stat.
 * Skips over_header/thead rows and column-header cells.
 */
export function parseRows(tableHtml) {
  const rows = [];
  for (const tr of tableHtml.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)) {
    if (/\b(over_header|thead)\b/.test(attr(tr[1], 'class') ?? '')) continue;
    const cells = {};
    for (const c of tr[2].matchAll(/<(t[dh])\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
      if (c[1].toLowerCase() === 'th' && /\bscope="col"/i.test(c[2])) continue;
      const stat = attr(c[2], 'data-stat');
      if (!stat) continue;
      const href = c[3].match(/<a\b[^>]*\bhref="([^"]*)"/i);
      cells[stat] = {
        text: stripTags(c[3]),
        href: href ? decodeEntities(href[1]) : null,
        id: attr(c[2], 'data-append-csv'),
        csk: attr(c[2], 'csk'),
      };
    }
    if (Object.keys(cells).length) rows.push(cells);
  }
  return rows;
}

export function playerIdFromHref(href) {
  const m = href && href.match(/\/players\/[a-z]\/([a-z0-9]+)\.html/i);
  return m ? m[1] : null;
}

/** Player rows only: have a linked player id; drops Team Totals and blanks. */
export function playerRows(tableHtml, nameStat) {
  const out = [];
  for (const row of parseRows(tableHtml)) {
    const cell = row[nameStat];
    if (!cell) continue;
    const id = playerIdFromHref(cell.href) ?? cell.id;
    if (!id || /^team totals$/i.test(cell.text)) continue;
    out.push({ id, name: cell.text, row });
  }
  return out;
}

const toInt = (s) => {
  const n = parseInt(String(s ?? '').replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
};

/**
 * GP per player id for one phase. Skater table uses `games`, goalie table `goalie_games`;
 * a goalie's GP is taken from the goalie table only (goalies also appear among skaters).
 */
export function phaseGames(skaterHtml, goalieHtml) {
  const gp = new Map(); // id -> { name, pos, gp }
  const goalieIds = new Set();
  if (goalieHtml) {
    for (const p of playerRows(goalieHtml, 'name_display')) {
      goalieIds.add(p.id);
      gp.set(p.id, { name: p.name, pos: 'G', gp: toInt(p.row.goalie_games?.text) });
    }
  }
  if (skaterHtml) {
    for (const p of playerRows(skaterHtml, 'name_display')) {
      if (goalieIds.has(p.id)) continue;
      const prev = gp.get(p.id);
      gp.set(p.id, { name: p.name, pos: p.row.pos?.text || null, gp: (prev?.gp ?? 0) + toInt(p.row.games?.text) });
    }
  }
  return gp;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

/** "August 17, 1943" -> "1943-08-17"; null if unparseable. */
export function parseBirthDate(text) {
  const m = String(text ?? '').match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  const mi = m ? MONTHS.indexOf(m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()) : -1;
  if (mi < 0) return null;
  return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}`;
}

// HR 2-letter flag codes -> 3-letter codes (NHL layer style).
const COUNTRY = {
  ca: 'CAN', us: 'USA', se: 'SWE', fi: 'FIN', cz: 'CZE', cs: 'CZE', sk: 'SVK', ru: 'RUS', su: 'RUS',
  de: 'DEU', gb: 'GBR', uk: 'GBR', ch: 'CHE', at: 'AUT', no: 'NOR', dk: 'DNK', fr: 'FRA', pl: 'POL',
  lv: 'LVA', ua: 'UKR', by: 'BLR', kz: 'KAZ', it: 'ITA', nl: 'NLD', hu: 'HUN', si: 'SVN', yu: 'SRB',
  au: 'AUS', ie: 'IRL', jp: 'JPN', be: 'BEL', lt: 'LTU', ee: 'EST', hr: 'HRV', rs: 'SRB', ar: 'ARG',
  bm: 'BMU', bs: 'BHS', ng: 'NGA', jm: 'JAM', ro: 'ROU',
};

export function countryFromFlag(flag) {
  if (!flag) return null;
  return COUNTRY[String(flag).trim().toLowerCase()] ?? null;
}

const POS_NHL = { LW: 'L', RW: 'R' };
export const positionNhlStyle = (pos) => (pos ? (POS_NHL[pos] ?? pos) : null);

const PARTICLES = new Set(['de', 'da', 'di', 'du', 'del', 'van', 'von', 'der', 'den', 'la', 'le', 'st.', 'st', 'mc', 'mac']);
const SUFFIXES = new Set(['jr.', 'jr', 'sr.', 'sr', 'ii', 'iii', 'iv']);

/** Splits a display name; flags anything that is not a plain "First Last" for review. */
export function splitName(name) {
  const tokens = name.trim().split(/\s+/);
  if (tokens.length === 1) return { firstName: '', lastName: tokens[0], nameNeedsReview: true };
  const lastName = tokens[tokens.length - 1];
  const firstName = tokens.slice(0, -1).join(' ');
  const review = tokens.length > 2
    || tokens.some((t, i) => i > 0 && (PARTICLES.has(t.toLowerCase()) || SUFFIXES.has(t.toLowerCase())));
  return { firstName, lastName, nameNeedsReview: review };
}

/** Parses a player's own page (#meta block). */
export function parsePlayerPage(html) {
  const i = html.indexOf('id="meta"');
  const end = i < 0 ? -1 : html.indexOf('id="bling"', i);
  const meta = i < 0 ? '' : html.slice(i, end > 0 ? end : i + 8000);
  const full = meta.match(/<strong>\s*Full Name:\s*<\/strong>\s*([^<]*)/i);
  const nick = meta.match(/<p>\s*\(([^)<]*)\)\s*<\/p>/i);
  const birth = meta.match(/data-birth="(\d{4}-\d{2}-\d{2})"/i);
  const bornP = meta.match(/<strong>\s*Born:\s*<\/strong>([\s\S]*?)<\/p>/i);
  let birthplace = null;
  let flag = null;
  if (bornP) {
    const inM = bornP[1].match(/<span>\s*in(?:&nbsp;|\s)([\s\S]*?)<\/span>/i);
    if (inM) birthplace = stripTags(inM[1]).replace(/\s+,/g, ',') || null;
    const f = bornP[1].match(/\bf-i\s+f-([a-z]{2})\b/i);
    flag = f ? f[1].toLowerCase() : null;
  }
  const pos = meta.match(/<strong>\s*Position\s*<\/strong>\s*:\s*([A-Za-z/]+)/i);
  return {
    fullName: full ? decodeEntities(full[1]).trim() || null : null,
    nickname: nick ? decodeEntities(nick[1]).trim() || null : null,
    birthDate: birth ? birth[1] : null,
    birthplace,
    flag,
    position: pos ? pos[1] : null,
  };
}

/** Parses one team-season page into Map id -> {name, pos, flag, birthDate, regularGP, playoffGP}. */
export function parseTeamSeason(html) {
  const t = (id) => extractTable(html, id);
  const reg = phaseGames(t('player_stats'), t('goalie_stats'));
  const post = phaseGames(t('player_stats_post'), t('goalie_stats_post'));
  const roster = new Map();
  const rosterHtml = t('roster');
  if (rosterHtml) {
    for (const p of playerRows(rosterHtml, 'player')) {
      roster.set(p.id, {
        pos: p.row.pos?.text || null,
        flag: p.row.flag?.csk || p.row.flag?.text.split(' ').pop() || null,
        birthDate: parseBirthDate(p.row.birth_date?.text),
      });
    }
  }
  const out = new Map();
  for (const id of new Set([...reg.keys(), ...post.keys()])) {
    const r = reg.get(id);
    const p = post.get(id);
    const ro = roster.get(id);
    out.set(id, {
      name: (r ?? p).name,
      pos: ro?.pos || (r ?? p).pos,
      flag: ro?.flag ?? null,
      birthDate: ro?.birthDate ?? null,
      regularGP: r?.gp ?? 0,
      playoffGP: p?.gp ?? 0,
    });
  }
  return out;
}

export const seasonLabel = (endYear) => `${endYear - 1}-${String(endYear).slice(2)}`;

/**
 * Whole-career season rows from a cached player page (skater and goalie tables, regular season and
 * playoffs): [{ season, league, team, regularGP, playoffGP }] per season/league/team, sorted.
 * Summary rows ("WHA (2 Yrs)", "Career", team totals) and multi-team "TOT" rows are skipped.
 */
export function parseCareerSeasons(html) {
  const rows = new Map();
  const tables = [['goalie_stats', 'goalie_games', 'regularGP'], ['goalie_stats_post', 'goalie_games', 'playoffGP'],
    ['player_stats', 'games', 'regularGP'], ['player_stats_post', 'games', 'playoffGP']];
  const goalie = { regularGP: false, playoffGP: false };
  for (const [id, stat, phase] of tables) {
    const t = extractTable(html, id);
    if (!t) continue;
    // A goalie's games come from the goalie table only (goalies can also appear among skaters).
    if (id.startsWith('player_') && goalie[phase]) continue;
    if (id.startsWith('goalie_')) goalie[phase] = true;
    for (const r of parseRows(t)) {
      const season = r.year_id?.text ?? '';
      const team = r.team_name_abbr?.text ?? '';
      const league = r.comp_name_abbr?.text || r.lg_id?.text || '';
      if (!/^\d{4}-\d{2}$/.test(season) || !team || team === 'TOT' || !league) continue;
      const gp = parseInt(String(r[stat]?.text ?? '').replace(/[^\d]/g, ''), 10) || 0;
      const key = `${season}|${league}|${team}`;
      const row = rows.get(key) ?? { season, league, team, regularGP: 0, playoffGP: 0 };
      row[phase] += gp;
      rows.set(key, row);
    }
  }
  return [...rows.values()].sort((a, b) => (a.season < b.season ? -1 : a.season > b.season ? 1 : a.league.localeCompare(b.league) || a.team.localeCompare(b.team)));
}

/** First regular season (label) with GP >= 1 in one of `leagues` from parseCareerSeasons rows, or null. */
export function firstCareerSeason(rows, leagues = ['NHL', 'WHA']) {
  const s = rows.filter((r) => leagues.includes(r.league) && r.regularGP > 0).map((r) => r.season).sort();
  return s[0] ?? null;
}

// ---------------------------------------------------------------- fetching

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let requests = 0;
let lastRequestAt = 0;
const refresh = process.argv.includes('--refresh');

async function cachedFetch(url, cacheName) {
  const file = resolve(CACHE_DIR, cacheName);
  if (!refresh) {
    try { return await readFile(file, 'utf8'); } catch { /* not cached */ }
  }
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    const wait = lastRequestAt + DELAY_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    requests++;
    console.log(`GET ${url} (request #${requests})`);
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'user-agent': USER_AGENT, accept: 'text/html' } });
    } catch (err) {
      if (attempt === RETRIES) throw err;
      await sleep(5000 * 2 ** attempt);
      continue;
    }
    if (res.status === 403) throw new Error(`HTTP 403 for ${url}: blocked / Cloudflare challenge. STOPPING.`);
    if (res.status === 429 || res.status >= 500) {
      if (attempt === RETRIES) throw new Error(`HTTP ${res.status} for ${url} after ${RETRIES} attempts`);
      await sleep(10000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const text = await res.text();
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, text);
    return text;
  }
}

// ---------------------------------------------------------------- main

async function main() {
  const withPlayers = !process.argv.includes('--no-players');
  const anomalies = [];
  const byId = new Map();

  for (const endYear of END_YEARS) {
    const season = seasonLabel(endYear);
    const html = await cachedFetch(TEAM_URL(endYear), `team_WNJ_${endYear}.html`);
    const rows = parseTeamSeason(html);
    if (!rows.size) anomalies.push(`${season}: no players parsed`);
    for (const [id, r] of rows) {
      let p = byId.get(id);
      if (!p) byId.set(id, (p = { sourceId: id, name: r.name, seasons: [], posList: [], flag: null, rosterBirth: null }));
      if (r.regularGP || r.playoffGP) p.seasons.push({ season, regularGP: r.regularGP, playoffGP: r.playoffGP });
      if (r.pos) p.posList.push(r.pos);
      p.flag ??= r.flag;
      p.rosterBirth ??= r.birthDate;
    }
  }

  const players = [];
  for (const p of byId.values()) {
    if (!p.seasons.length) continue; // listed but never played
    let page = null;
    if (withPlayers) {
      const html = await cachedFetch(PLAYER_URL(p.sourceId), `player_${p.sourceId}.html`);
      page = parsePlayerPage(html);
    }
    const counts = {};
    for (const pos of p.posList) counts[pos] = (counts[pos] ?? 0) + 1;
    // most frequent position, ties -> most recently listed
    const position = [...p.posList].reverse().sort((a, b) => counts[b] - counts[a])[0] ?? page?.position ?? null;
    if (Object.keys(counts).length > 1) anomalies.push(`${p.name} (${p.sourceId}): multiple positions ${JSON.stringify(counts)} -> ${position}`);
    if (position && !['C', 'LW', 'RW', 'D', 'G'].includes(position)) anomalies.push(`${p.name}: unexpected position "${position}"`);
    const birthDate = page?.birthDate ?? p.rosterBirth ?? null;
    if (page?.birthDate && p.rosterBirth && page.birthDate !== p.rosterBirth) anomalies.push(`${p.name}: birth date mismatch roster ${p.rosterBirth} vs page ${page.birthDate}`);
    const flag = page?.flag ?? p.flag;
    const country = countryFromFlag(flag);
    if (flag && !country) anomalies.push(`${p.name}: unmapped country flag "${flag}"`);
    const split = splitName(p.name);
    p.seasons.sort((a, b) => a.season.localeCompare(b.season));
    const totals = p.seasons.reduce((t, s) => ({ regularGP: t.regularGP + s.regularGP, playoffGP: t.playoffGP + s.playoffGP }), { regularGP: 0, playoffGP: 0 });
    players.push({
      sourceId: p.sourceId,
      name: p.name,
      fullName: page?.fullName ?? null,
      nickname: page?.nickname ?? null,
      firstName: split.firstName,
      lastName: split.lastName,
      ...(split.nameNeedsReview ? { nameNeedsReview: true } : {}),
      birthDate,
      birthplace: page?.birthplace ?? null,
      country,
      position,
      positionNhlStyle: positionNhlStyle(position),
      seasons: p.seasons,
      totals,
    });
  }

  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  players.sort((a, b) => cmp(a.lastName, b.lastName) || cmp(a.firstName, b.firstName) || cmp(a.sourceId, b.sourceId));

  // validation
  if (new Set(players.map((p) => p.sourceId)).size !== players.length) throw new Error('duplicate sourceIds');
  for (const p of players) {
    const r = p.seasons.reduce((n, s) => n + s.regularGP, 0);
    const o = p.seasons.reduce((n, s) => n + s.playoffGP, 0);
    if (r !== p.totals.regularGP || o !== p.totals.playoffGP) throw new Error(`totals mismatch ${p.sourceId}`);
    if (r + o === 0) throw new Error(`zero GP player ${p.sourceId}`);
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: { site: 'hockey-reference.com', definitive: false, urls: [`${BASE}/teams/WNJ/{endYear}.html`, `${BASE}/players/{initial}/{sourceId}.html`] },
    players,
  }, null, 2) + '\n');

  const playoffOnly = players.filter((p) => p.totals.regularGP === 0).map((p) => p.name);
  console.log(`\nWrote ${OUT}`);
  console.log(`players=${players.length} goalies=${players.filter((p) => p.position === 'G').length} requests=${requests}`);
  console.log(`playoff-only: ${playoffOnly.join(', ') || '(none)'}`);
  console.log(`nameNeedsReview: ${players.filter((p) => p.nameNeedsReview).map((p) => p.name).join('; ') || '(none)'}`);
  console.log(`null birthDate=${players.filter((p) => !p.birthDate).length} null country=${players.filter((p) => !p.country).length} null fullName=${players.filter((p) => !p.fullName).length}`);
  for (const a of anomalies) console.log(`ANOMALY: ${a}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
