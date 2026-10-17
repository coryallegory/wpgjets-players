// Pull every WHA Winnipeg Jets player (1972-73..1978-79, regular season or playoffs) from
// hockeydb.com as an independent cross-check of the Hockey-Reference pull.
// Writes temp/reference/hockeydb-wha-jets.json. Zero dependencies (Node 22).
//
// Polite: descriptive User-Agent, sequential requests >= 2s apart, backoff on 429/5xx, stops on
// 403/challenge, caches every page under temp/cache/hockeydb/ (use --refresh to bypass).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(ROOT, 'temp', 'cache', 'hockeydb');
const OUT_FILE = path.join(ROOT, 'temp', 'reference', 'hockeydb-wha-jets.json');
const BASE = 'https://www.hockeydb.com/ihdb/stats';
const LIST_URL = `${BASE}/display_players.php?tmi=9023`;
const seasonUrl = (endYear) => `${BASE}/leagues/seasons/teams/000168${endYear}.html`;
const playerUrl = (pid) => `${BASE}/pdisplay.php?pid=${pid}`;
const END_YEARS = [1973, 1974, 1975, 1976, 1977, 1978, 1979];
const USER_AGENT =
  'wpgjets-players-personal-research/1.0 (one-time personal-use pull; contact corymetcalfe@gmail.com)';
const MIN_GAP_MS = 2200;

// ---------------------------------------------------------------- pure parsing helpers

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', aacute: 'á', agrave: 'à', acirc: 'â',
  auml: 'ä', aring: 'å', oacute: 'ó', ograve: 'ò', ocirc: 'ô', ouml: 'ö', oslash: 'ø',
  iacute: 'í', icirc: 'î', iuml: 'ï', uacute: 'ú', ucirc: 'û', uuml: 'ü', ccedil: 'ç',
  ntilde: 'ñ', dagger: '†', Dagger: '‡', Eacute: 'É', Aring: 'Å', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü',
};

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return Object.hasOwn(NAMED_ENTITIES, e) ? NAMED_ENTITIES[e] : m;
  });
}

/** Trailing footnote markers (dagger / double dagger) hockeydb puts after some names. */
export function stripMarkers(s) {
  return s.replace(/\s*[†‡]+\s*$/u, '').trim();
}

export function cellText(html) {
  return decodeEntities(html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, ''))
    .replace(/[\s ]+/g, ' ')
    .trim();
}

/** All tables in the page as { html, rows: [ { html, cells: [ { html, text, attrs } ] } ] }. */
export function parseTables(html) {
  const tables = [];
  for (const tm of html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)) {
    const rows = [];
    for (const rm of tm[0].matchAll(/<tr\b([^>]*)>([\s\S]*?)(?=<\/tr>|<tr\b|<\/table>)/gi)) {
      const cells = [];
      for (const cm of rm[2].matchAll(/<t([dh])\b([^>]*)>([\s\S]*?)(?=<\/t[dh]>|<t[dh]\b|$)/gi)) {
        cells.push({ tag: cm[1].toLowerCase(), attrs: cm[2], html: cm[3], text: cellText(cm[3]) });
      }
      rows.push({ attrs: rm[1], html: rm[2], cells });
    }
    tables.push({ html: tm[0], rows });
  }
  return tables;
}

function pidFromHtml(html) {
  const m = html.match(/pdisplay\.php\?pid=(\d+)/i);
  return m ? m[1] : null;
}

function toInt(text) {
  const t = text.trim();
  if (t === '' || /^[-–—]+$/.test(t)) return 0;
  const n = Number(t.replace(/,/g, ''));
  return Number.isInteger(n) ? n : null;
}

/** All-time list rows: Player Name | GP | G | A | Pts | PIM | Seasons | Yrs | Pos | Birthdate | Birthplace | Level */
export function parsePlayerList(html) {
  const out = [];
  for (const table of parseTables(html)) {
    const head = table.rows.find((r) => r.cells.some((c) => /player name/i.test(c.text)));
    if (!head) continue;
    const col = (re) => head.cells.findIndex((c) => re.test(c.text));
    const iName = col(/player name/i);
    const iGP = col(/^gp$/i);
    const iSeasons = col(/^seasons$/i);
    const iPos = col(/^pos/i);
    const iBirth = col(/birthdate/i);
    const iPlace = col(/birthplace/i);
    for (const row of table.rows) {
      if (row === head) continue;
      const pid = pidFromHtml(row.cells[iName]?.html ?? '');
      if (!pid) continue;
      row.cells[iName].text = stripMarkers(row.cells[iName].text);
      const birth =row.cells[iBirth]?.text ?? '';
      out.push({
        pid,
        rawName: row.cells[iName].text,
        gp: toInt(row.cells[iGP]?.text ?? ''),
        years: row.cells[iSeasons]?.text ?? '',
        position: row.cells[iPos]?.text || null,
        birthDate: /^\d{4}-\d{2}-\d{2}$/.test(birth) ? birth : null,
        birthplace: row.cells[iPlace]?.text || null,
      });
    }
  }
  return out;
}

/**
 * Team-season page. Skater table has regular and playoff GP columns (two "GP" headers);
 * goalie table only carries regular GP (playoffGP is null = unknown from this page).
 */
export function parseTeamSeason(html) {
  const players = [];
  for (const table of parseTables(html)) {
    const head = table.rows.find((r) => r.cells.some((c) => /player name/i.test(c.text)));
    if (!head) continue;
    const gpIdx = head.cells.map((c, i) => (/^gp$/i.test(c.text) ? i : -1)).filter((i) => i >= 0);
    if (gpIdx.length === 0) continue;
    const iName = head.cells.findIndex((c) => /player name/i.test(c.text));
    const iPos = head.cells.findIndex((c) => /^pos/i.test(c.text));
    const isGoalieTable = gpIdx.length === 1;
    for (const row of table.rows) {
      if (row === head) continue;
      const nameCell = row.cells[iName];
      const pid = nameCell ? pidFromHtml(nameCell.html) : null;
      if (!pid) continue;
      players.push({
        pid,
        name: stripMarkers(nameCell.text),
        position: isGoalieTable ? 'G' : row.cells[iPos]?.text || null,
        regularGP: toInt(row.cells[gpIdx[0]]?.text ?? ''),
        playoffGP: isGoalieTable ? null : toInt(row.cells[gpIdx[1]]?.text ?? ''),
        birthplace: isGoalieTable ? null : row.cells.at(-2)?.text || null,
      });
    }
  }
  return players;
}

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

/** Player page: bio plus per-WHA-Jets-season regular/playoff GP (from RS and PO tables). */
export function parsePlayerPage(html) {
  const born = html.match(/Born\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{4})/);
  let birthDate = null;
  if (born && MONTHS[born[1]]) {
    birthDate = `${born[3]}-${String(MONTHS[born[1]]).padStart(2, '0')}-${born[2].padStart(2, '0')}`;
  }
  const hm = html.match(/<span[^>]*class="hometown"[^>]*>([\s\S]*?)<\/span>/i);
  const birthplace = hm ? cellText(hm[1]) || null : null;
  const seasons = {}; // endYear -> { regularGP, playoffGP }
  for (const table of parseTables(html)) {
    const head = table.rows.find((r) => r.cells.some((c) => /^gp$/i.test(c.text)));
    if (!head) continue;
    const gpIdx = head.cells.map((c, i) => (/^gp$/i.test(c.text) ? i : -1)).filter((i) => i >= 0);
    const kindCell = table.rows.flatMap((r) => r.cells).find((c) => /^(RS|PO)\s/.test(c.text));
    // Separate RS / PO tables ("RS Scoring"/"PO Scoring"), or one combined table with two GP columns.
    const cols = kindCell
      ? [[gpIdx[0], kindCell.text.startsWith('RS') ? 'regularGP' : 'playoffGP']]
      : gpIdx.length >= 2
        ? [[gpIdx[0], 'regularGP'], [gpIdx[1], 'playoffGP']]
        : [];
    for (const row of table.rows) {
      const m = row.html.match(/teams\/000168(\d{4})\.html/);
      if (!m) continue;
      const end = Number(m[1]);
      seasons[end] ??= { regularGP: 0, playoffGP: 0 };
      for (const [idx, kind] of cols) seasons[end][kind] += toInt(row.cells[idx]?.text ?? '') ?? 0;
    }
  }
  return { birthDate, birthplace, seasons };
}

const CA_REGIONS = new Set(['ONT', 'MAN', 'SASK', 'ALTA', 'PQ', 'QUE', 'BC', 'NS', 'NB', 'PEI', 'NFLD', 'NL', 'NWT', 'YUK', 'NU']);
const US_STATES = new Set(
  'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '),
);
const COUNTRY_NAMES = {
  sweden: 'SWE', finland: 'FIN', norway: 'NOR', denmark: 'DNK', germany: 'DEU', 'west germany': 'DEU',
  switzerland: 'CHE', czechoslovakia: 'CZE', 'czech republic': 'CZE', slovakia: 'SVK', russia: 'RUS',
  ussr: 'RUS', usa: 'USA', canada: 'CAN', scotland: 'GBR', england: 'GBR', 'united kingdom': 'GBR',
  austria: 'AUT', poland: 'POL', france: 'FRA', netherlands: 'NLD', italy: 'ITA',
};

/** Region token from "Toronto, ONT", "ONT: Toronto", "Falun, Sweden", "Sweden: Falun" or "Sweden". */
export function countryFromBirthplace(bp) {
  if (!bp) return null;
  const s = bp.trim();
  const tokens = s.includes(':') ? [s.split(':')[0].trim()] : [s.split(',').at(-1).trim()];
  if (!s.includes(':') && !s.includes(',')) tokens.push(s);
  for (const t of tokens) {
    const up = t.toUpperCase();
    if (CA_REGIONS.has(up)) return 'CAN';
    if (US_STATES.has(up)) return 'USA';
    const c = COUNTRY_NAMES[t.toLowerCase()];
    if (c) return c;
  }
  return null;
}

/**
 * Splits a hockeydb display name. Nickname in quotes is pulled out into `nickname`/`aliases`.
 * Names that are not exactly "First Last" (suffixes, particles, 3+ tokens) set nameNeedsReview.
 */
export function parseName(raw) {
  const nickMatch = raw.match(/["“]([^"”]+)["”]/);
  const nickname = nickMatch ? nickMatch[1].trim() : null;
  const name = raw.replace(/["“][^"”]+["”]/, ' ').replace(/\s+/g, ' ').trim();
  const tokens = name.split(' ');
  const aliases = [];
  if (nickname) {
    aliases.push(`${nickname} ${tokens.at(-1)}`.trim());
  }
  let firstName;
  let lastName;
  let nameNeedsReview = false;
  if (tokens.length === 2 && !/^(jr|sr|ii|iii|iv)\.?$/i.test(tokens[1])) {
    [firstName, lastName] = tokens;
  } else {
    nameNeedsReview = true;
    lastName = tokens.at(-1);
    firstName = tokens.slice(0, -1).join(' ');
  }
  return { name, fullName: null, nickname, aliases, firstName, lastName, nameNeedsReview };
}

export function nhlStylePosition(pos) {
  if (!pos) return { positionNhlStyle: null };
  const p = pos.trim().toUpperCase();
  if (p === 'LW') return { positionNhlStyle: 'L' };
  if (p === 'RW') return { positionNhlStyle: 'R' };
  if (['C', 'L', 'R', 'D', 'G'].includes(p)) return { positionNhlStyle: p };
  if (p === 'F') return { positionNhlStyle: null, positionNote: 'hockeydb gives generic F (forward); wing/centre unknown' };
  return { positionNhlStyle: null, positionNote: `unrecognised hockeydb position "${pos}"` };
}

export const seasonLabel = (endYear) => `${endYear - 1}-${String(endYear).slice(-2)}`;

// ---------------------------------------------------------------- fetching with cache

let lastRequestAt = 0;
let requestCount = 0;
const refresh = process.argv.includes('--refresh');
const usedUrls = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function looksLikeChallenge(body) {
  return /cf-browser-verification|Just a moment\.\.\.|captcha|Attention Required/i.test(body.slice(0, 5000)) &&
    !/<table/i.test(body);
}

async function fetchCached(url, cacheName) {
  const file = path.join(CACHE_DIR, cacheName);
  usedUrls.push(url);
  if (!refresh) {
    try {
      return await readFile(file, 'utf8');
    } catch {
      /* not cached */
    }
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = lastRequestAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    requestCount++;
    console.log(`GET ${url}${attempt ? ` (retry ${attempt})` : ''}`);
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } });
    if (res.status === 403) {
      throw new Error(`403 Forbidden from ${url}: stopping (possible block/challenge).`);
    }
    if (res.status === 429 || res.status >= 500) {
      const backoff = 5000 * 2 ** attempt;
      console.log(`  HTTP ${res.status}; backing off ${backoff}ms`);
      await sleep(backoff);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const body = await res.text();
    if (looksLikeChallenge(body)) throw new Error(`Challenge page returned for ${url}: stopping.`);
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, body, 'utf8');
    return body;
  }
  throw new Error(`Giving up on ${url} after retries`);
}

// ---------------------------------------------------------------- main

async function main() {
  const anomalies = [];
  const note = (m) => {
    anomalies.push(m);
    console.warn(`ANOMALY: ${m}`);
  };

  const list = parsePlayerList(await fetchCached(LIST_URL, 'list-9023.html'));
  console.log(`all-time list: ${list.length} players`);
  const byPid = new Map();
  for (const p of list) {
    if (byPid.has(p.pid)) note(`duplicate pid ${p.pid} in list`);
    byPid.set(p.pid, p);
  }

  // per-pid per-season GP from team-season pages
  const seasonGP = new Map(); // pid -> { endYear -> {regularGP, playoffGP|null} }
  const seasonInfo = new Map(); // pid -> { name, position, birthplace }
  for (const end of END_YEARS) {
    const html = await fetchCached(seasonUrl(end), `season-${end}.html`);
    const rows = parseTeamSeason(html);
    console.log(`${seasonLabel(end)}: ${rows.length} rows`);
    if (rows.length === 0) note(`no player rows parsed for ${seasonLabel(end)}`);
    for (const r of rows) {
      if (/^bench$/i.test(r.name)) {
        note(`ignoring non-player "${r.name}" (pid ${r.pid}) on ${seasonLabel(end)} page`);
        continue;
      }
      const m = seasonGP.get(r.pid) ?? {};
      const entry = { regularGP: r.regularGP ?? 0, playoffGP: r.playoffGP };
      if (m[end]) {
        // goalies appear in both the skater table (regular + playoff GP) and the goalie table (regular GP)
        if (m[end].regularGP !== entry.regularGP) {
          note(`${r.name} ${seasonLabel(end)}: skater/goalie table regular GP differ (${m[end].regularGP} vs ${entry.regularGP})`);
        }
        if (entry.playoffGP !== null) m[end] = entry;
      } else {
        m[end] = entry;
      }
      seasonGP.set(r.pid, m);
      if (!seasonInfo.has(r.pid)) seasonInfo.set(r.pid, r);
    }
  }

  const allPids = new Set([...byPid.keys(), ...seasonGP.keys()]);
  for (const pid of allPids) {
    if (!byPid.has(pid)) note(`pid ${pid} ${seasonInfo.get(pid).name} on season pages but not in all-time list`);
    if (!seasonGP.has(pid)) note(`pid ${pid} ${byPid.get(pid).rawName} in all-time list but on no season page`);
  }

  // Player pages only where needed: goalies (playoff GP not on team page), players absent from
  // the list or season pages, and missing birth date / country.
  const players = [];
  for (const pid of [...allPids].sort((a, b) => Number(a) - Number(b))) {
    const l = byPid.get(pid);
    const si = seasonInfo.get(pid);
    const sg = seasonGP.get(pid) ?? {};
    const position = l?.position ?? si?.position ?? null;
    const isGoalie = position === 'G' || si?.position === 'G';
    let birthDate = l?.birthDate ?? null;
    let birthplace = l?.birthplace ?? si?.birthplace ?? null;
    if (birthplace && /^[\s\-]*$/.test(birthplace)) birthplace = null;
    let country = countryFromBirthplace(birthplace);
    const needPage = !l || !sg || Object.keys(sg).length === 0 || !birthDate || !country;

    let page = null;
    if (needPage) {
      page = parsePlayerPage(await fetchCached(playerUrl(pid), `player-${pid}.html`));
      if (!birthDate) birthDate = page.birthDate;
      if (!birthplace && page.birthplace) {
        birthplace = page.birthplace;
        country = countryFromBirthplace(birthplace);
      } else if (!country && page.birthplace) {
        country = countryFromBirthplace(page.birthplace);
      }
    }
    if (birthplace && !country) note(`cannot derive country for ${pid} birthplace "${birthplace}"`);

    // merge seasons
    const ends = new Set([...Object.keys(sg), ...Object.keys(page?.seasons ?? {})].map(Number));
    const seasons = [];
    for (const end of [...ends].sort()) {
      const t = sg[end];
      const p = page?.seasons[end];
      let regularGP = t?.regularGP ?? p?.regularGP ?? 0;
      let playoffGP = t?.playoffGP ?? p?.playoffGP ?? 0;
      const nm = (l?.rawName ?? si?.name ?? pid);
      if (t && p) {
        if (t.regularGP !== p.regularGP) note(`${nm} ${seasonLabel(end)}: regular GP team page ${t.regularGP} vs player page ${p.regularGP}`);
        if (t.playoffGP !== null && t.playoffGP !== p.playoffGP) note(`${nm} ${seasonLabel(end)}: playoff GP team page ${t.playoffGP} vs player page ${p.playoffGP}`);
      } else if (!t && p) {
        note(`${nm} ${seasonLabel(end)}: only on player page (regular ${p.regularGP}, playoff ${p.playoffGP})`);
      } else if (t && !p && page && t.regularGP + (t.playoffGP ?? 0) > 0) {
        note(`${nm} ${seasonLabel(end)}: on team page but not found on player page`);
      }
      if (regularGP + playoffGP === 0) continue; // listed with no games (e.g. "--" both)
      seasons.push({ season: seasonLabel(end), regularGP, playoffGP });
    }

    const totals = {
      regularGP: seasons.reduce((a, s) => a + s.regularGP, 0),
      playoffGP: seasons.reduce((a, s) => a + s.playoffGP, 0),
    };
    if (l && l.gp !== null && l.gp !== totals.regularGP) {
      note(`${l.rawName}: all-time list GP ${l.gp} vs summed regular GP ${totals.regularGP}`);
    }
    if (totals.regularGP + totals.playoffGP < 1) {
      note(`${l?.rawName ?? si?.name ?? pid} has no games; excluded`);
      continue;
    }
    const nameParts = parseName(l?.rawName ?? si.name);
    players.push({
      sourceId: pid,
      ...nameParts,
      birthDate: birthDate ?? null,
      birthplace: birthplace ?? null,
      country: country ?? null,
      position,
      ...nhlStylePosition(position),
      seasons,
      totals,
    });
  }

  players.sort(
    (a, b) =>
      a.lastName.localeCompare(b.lastName) ||
      a.firstName.localeCompare(b.firstName) ||
      a.sourceId.localeCompare(b.sourceId, undefined, { numeric: true }),
  );

  // validation
  const ids = new Set(players.map((p) => p.sourceId));
  if (ids.size !== players.length) throw new Error('duplicate sourceIds');
  for (const p of players) {
    const r = p.seasons.reduce((a, s) => a + s.regularGP, 0);
    const o = p.seasons.reduce((a, s) => a + s.playoffGP, 0);
    if (r !== p.totals.regularGP || o !== p.totals.playoffGP) throw new Error(`totals mismatch ${p.name}`);
    if (p.totals.regularGP + p.totals.playoffGP < 1) throw new Error(`no GP ${p.name}`);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    source: {
      site: 'hockeydb.com',
      definitive: false,
      urls: [...new Set(usedUrls)],
    },
    players,
  };
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(output, null, 2) + '\n', 'utf8');

  const playoffOnly = players.filter((p) => p.totals.regularGP === 0).map((p) => p.name);
  console.log(`\nWrote ${path.relative(ROOT, OUT_FILE)}: ${players.length} players`);
  console.log(`network requests: ${requestCount}`);
  console.log(`playoff-only: ${playoffOnly.join(', ') || '(none)'}`);
  console.log(`nameNeedsReview: ${players.filter((p) => p.nameNeedsReview).map((p) => p.name).join(', ') || '(none)'}`);
  console.log(`null birthDate: ${players.filter((p) => !p.birthDate).map((p) => p.name).join(', ') || '(none)'}`);
  console.log(`null country: ${players.filter((p) => !p.country).map((p) => p.name).join(', ') || '(none)'}`);
  console.log(`anomalies: ${anomalies.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
