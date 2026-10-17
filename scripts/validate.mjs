// Validates site/data/curated/players.json (schema v2) if present. No dependencies.
// Usage: npm run validate
//
// Schema v2 player: playerId, firstName, lastName, name ("Last, First"), country, birthDate,
// positions, rookieSeason (first NHL season on any team; null without an NHL career),
// nhl { regularGP, playoffGP, seasons[{ season, team WIN|WPG, regularGP, playoffGP }] } (NHL Jets,
// always present), wha? { regularGP, playoffGP, seasons[{ season, regularGP, playoffGP }],
// source { sites[], definitive, retrieved } } (WHA Jets 1972-73..1978-79, only if played), draft,
// qualifiedBy ("played" = NHL or WHA Jets GP >= 1; "drafted" = NHL draft by a Jets franchise),
// source { site, definitive, ... }, notes? [string], needsReview? [field name].
// WHA-only players use playerIds 900001+.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAYERS_FILE = path.join(ROOT, 'site', 'data', 'curated', 'players.json');

const SEASON_PATTERN = /^(\d{4})-(\d{2})$/;

function isValidSeason(season) {
  const match = SEASON_PATTERN.exec(season);
  if (!match) return false;
  return (Number(match[1]) + 1) % 100 === Number(match[2]);
}

/** True for a real calendar date string "YYYY-MM-DD" (rejects e.g. 1980-02-30). */
export function isValidIsoDate(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [y, m, d] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Derived sortable display name: "Last, First" (just the last name when there is no first name). */
export const sortableName = (firstName, lastName) => (firstName ? `${lastName}, ${firstName}` : lastName);

const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';
const isCount = (v) => Number.isInteger(v) && v >= 0;

/** Schema version of site/data/curated/players.json described by this validator. */
export const SCHEMA_VERSION = 2;
/** playerIds 900000-999999 are reserved for WHA-only players (issued from 900001). */
export const WHA_ID_MIN = 900001;
export const isWhaReservedId = (id) => Number.isInteger(id) && id >= WHA_ID_MIN - 1 && id < 1000000;
const WHA_FIRST_SEASON = '1972-73';
const WHA_LAST_SEASON = '1978-79';

/**
 * Shared checks for a GP block ({ regularGP, playoffGP, seasons[] }): counts, season labels,
 * duplicate rows, totals equal to the season sums. `rowCheck(row)` adds block-specific checks.
 */
function checkGpBlock(block, name, add, rowCheck) {
  if (!isPlainObject(block)) return add(`${name} must be an object`);
  if (!isCount(block.regularGP)) add(`${name}.regularGP must be a non-negative integer`);
  if (!isCount(block.playoffGP)) add(`${name}.playoffGP must be a non-negative integer`);
  if (!Array.isArray(block.seasons)) return add(`${name}.seasons must be an array`);

  let regular = 0;
  let playoff = 0;
  let countsOk = true;
  const seen = new Set();
  for (const row of block.seasons) {
    if (!isPlainObject(row)) {
      add(`${name}.seasons entries must be objects`);
      countsOk = false;
      continue;
    }
    if (typeof row.season !== 'string' || !isValidSeason(row.season)) {
      add(`${name}: invalid season ${JSON.stringify(row.season)} (expected like "1990-91")`);
    }
    rowCheck(row);
    const rowKey = `${row.season}|${row.team ?? ''}`;
    if (seen.has(rowKey)) add(`${name}: duplicate season row ${row.season}${row.team ? ` ${row.team}` : ''}`);
    seen.add(rowKey);
    for (const key of ['regularGP', 'playoffGP']) {
      if (isCount(row[key])) continue;
      add(`${name} season ${row.season}: ${key} must be a non-negative integer`);
      countsOk = false;
    }
    if (countsOk) {
      regular += row.regularGP;
      playoff += row.playoffGP;
    }
  }
  if (!countsOk) return;
  if (isCount(block.regularGP) && block.regularGP !== regular) {
    add(`${name}.regularGP ${block.regularGP} does not equal season sum ${regular}`);
  }
  if (isCount(block.playoffGP) && block.playoffGP !== playoff) {
    add(`${name}.playoffGP ${block.playoffGP} does not equal season sum ${playoff}`);
  }
}

/** NHL Jets (1.0 WIN, 2.0 WPG) games. Always present; zeros/empty seasons without NHL Jets games. */
function checkNhl(nhl, add) {
  checkGpBlock(nhl, 'nhl', add, (row) => {
    if (row.team !== 'WIN' && row.team !== 'WPG') add(`nhl: invalid team ${JSON.stringify(row.team)} (expected WIN or WPG)`);
  });
}

/** WHA Winnipeg Jets games (1972-73 to 1978-79). Optional; present only for players who played. */
function checkWha(wha, add) {
  checkGpBlock(wha, 'wha', add, (row) => {
    if (typeof row.season === 'string' && isValidSeason(row.season) && (row.season < WHA_FIRST_SEASON || row.season > WHA_LAST_SEASON)) {
      add(`wha: season ${row.season} is outside ${WHA_FIRST_SEASON}..${WHA_LAST_SEASON}`);
    }
    if (row.team !== undefined) add('wha: season rows have no team field');
  });
  if (!isPlainObject(wha)) return;
  if (Array.isArray(wha.seasons) && wha.seasons.length === 0) add('wha.seasons must not be empty (omit wha for players without WHA Jets games)');
  const s = wha.source;
  if (!isPlainObject(s)) return add('wha.source must be an object');
  if (!Array.isArray(s.sites) || s.sites.length === 0 || !s.sites.every(isNonEmptyString)) add('wha.source.sites must be a non-empty array of strings');
  if (typeof s.definitive !== 'boolean') add('wha.source.definitive must be a boolean');
  if (!isValidIsoDate(s.retrieved)) add(`wha.source.retrieved must be a real date "YYYY-MM-DD" (got ${JSON.stringify(s.retrieved)})`);
}

const gpTotal = (block) => (isPlainObject(block) && isCount(block.regularGP) && isCount(block.playoffGP) ? block.regularGP + block.playoffGP : null);

function checkNotes(player, add) {
  if (player.notes !== undefined && (!Array.isArray(player.notes) || !player.notes.every(isNonEmptyString))) {
    add('notes must be an array of non-empty strings');
  }
  const r = player.needsReview;
  if (r === undefined) return;
  if (!Array.isArray(r) || r.length === 0 || !r.every(isNonEmptyString)) return add('needsReview must be a non-empty array of field names');
  if (new Set(r).size !== r.length) add('needsReview has duplicates');
  for (const f of r) if (!(f in player) || f === 'needsReview') add(`needsReview names ${JSON.stringify(f)}, which is not a field of this player`);
}

/** WHA-only players: reserved id range, no NHL Jets games; and every reserved id is WHA-only. */
function checkWhaOnly(player, add) {
  const id = player.playerId;
  const reserved = isWhaReservedId(id);
  const nhlEmpty = isPlainObject(player.nhl) && Array.isArray(player.nhl.seasons) && player.nhl.seasons.length === 0;
  const looksWhaOnly = player.wha !== undefined && nhlEmpty && player.draft === null && player.rookieSeason === null;
  if (reserved) {
    if (id < WHA_ID_MIN) add(`playerId ${id} is reserved and never issued (WHA-only ids start at ${WHA_ID_MIN})`);
    if (player.wha === undefined) add('WHA-only playerId (900001+) requires a wha block');
    if (!nhlEmpty) add('WHA-only playerId (900001+) must have empty nhl.seasons');
    if (player.rookieSeason !== null) add('WHA-only playerId (900001+) must have rookieSeason null (no NHL career)');
  } else if (looksWhaOnly) {
    add('WHA-only player (wha block, no NHL Jets games, no draft, no NHL career) must have a playerId in the 900001+ range');
  }
}

function checkDraft(draft, add) {
  if (draft === null) return;
  if (!isPlainObject(draft)) return add('draft must be null or an object');
  if (!Number.isInteger(draft.year)) add('draft.year must be an integer');
  if (!isNonEmptyString(draft.team)) add('draft.team must be a non-empty string');
  if (!Number.isInteger(draft.round) || draft.round < 1) add('draft.round must be a positive integer');
  if (!Number.isInteger(draft.overall) || draft.overall < 1) add('draft.overall must be a positive integer');
  if (draft.amateur !== null && !isNonEmptyString(draft.amateur)) {
    add('draft.amateur must be null or a non-empty string');
  }
}

function checkQualifiedBy(player, add) {
  const q = player.qualifiedBy;
  if (!Array.isArray(q) || q.length === 0 || !q.every((v) => v === 'played' || v === 'drafted')) {
    return add('qualifiedBy must be a non-empty array of "played"/"drafted"');
  }
  if (new Set(q).size !== q.length) add('qualifiedBy has duplicates');
  const nhlGp = gpTotal(player.nhl);
  const whaGp = player.wha === undefined ? 0 : gpTotal(player.wha);
  if (nhlGp !== null && whaGp !== null) {
    const played = nhlGp + whaGp >= 1;
    if (q.includes('played') !== played) {
      add(played ? 'has Jets GP (NHL or WHA) but qualifiedBy lacks "played"' : 'qualifiedBy has "played" but Jets GP (NHL + WHA) is 0');
    }
  }
  if (q.includes('drafted') && !player.draft) add('qualifiedBy has "drafted" but draft is null');
}

/** Returns an array of human-readable error strings; an empty array means valid. */
export function validatePlayers(players) {
  if (!Array.isArray(players)) {
    return ['players must be an array'];
  }

  const errors = [];
  const seenIds = new Set();
  const seenIdentities = new Map();

  players.forEach((player, index) => {
    const label = `players[${index}]`;
    if (!isPlainObject(player)) {
      errors.push(`${label}: must be an object`);
      return;
    }

    const id = player.playerId;
    if (!Number.isInteger(id)) {
      errors.push(`${label}: playerId must be a number`);
    } else if (seenIds.has(id)) {
      errors.push(`${label}: duplicate playerId ${id}`);
    } else {
      seenIds.add(id);
    }

    const itemLabel = Number.isInteger(id) ? `${label} (playerId ${id})` : label;
    const add = (msg) => errors.push(`${itemLabel}: ${msg}`);

    if (typeof player.firstName !== 'string') add('firstName must be a string');
    if (!isNonEmptyString(player.lastName)) add('lastName must be a non-empty string');
    if (!isNonEmptyString(player.name)) {
      add('name must be a non-empty string');
    } else if (typeof player.firstName === 'string' && typeof player.lastName === 'string') {
      const expected = sortableName(player.firstName, player.lastName);
      if (player.name !== expected) add(`name ${JSON.stringify(player.name)} must equal ${JSON.stringify(expected)}`);
    }
    if (player.birthDate !== null && !isValidIsoDate(player.birthDate)) {
      add(`invalid birthDate ${JSON.stringify(player.birthDate)} (expected null or a real date "YYYY-MM-DD")`);
    }
    if (typeof player.birthDate === 'string' && isValidIsoDate(player.birthDate)
        && typeof player.firstName === 'string' && typeof player.lastName === 'string') {
      const key = JSON.stringify([player.lastName, player.firstName, player.birthDate]);
      if (seenIdentities.has(key)) {
        add(`same lastName/firstName/birthDate as playerId ${seenIdentities.get(key)} (${player.name}, ${player.birthDate})`);
      } else {
        seenIdentities.set(key, id);
      }
    }
    if (!Array.isArray(player.positions) || !player.positions.every(isNonEmptyString)) {
      add('positions must be an array of non-empty strings');
    }
    if (player.rookieSeason !== null && (typeof player.rookieSeason !== 'string' || !isValidSeason(player.rookieSeason))) {
      add(`invalid rookieSeason ${JSON.stringify(player.rookieSeason)} (expected null or like "1990-91")`);
    }
    if (player.jets !== undefined) add('jets was renamed to nhl in schema v2 (run npm run merge:wha to migrate)');
    checkNhl(player.nhl, add);
    if (player.wha !== undefined) checkWha(player.wha, add);
    checkDraft(player.draft === undefined ? 'missing' : player.draft, add);
    checkQualifiedBy(player, add);
    checkWhaOnly(player, add);
    checkNotes(player, add);

    if (!isPlainObject(player.source)) {
      add('source must be an object');
    } else {
      if (!isNonEmptyString(player.source.site)) add('source.site must be a non-empty string');
      if (typeof player.source.definitive !== 'boolean') add('source.definitive must be a boolean');
    }
  });

  return errors;
}

async function main() {
  const displayPath = path.relative(ROOT, PLAYERS_FILE);

  let raw;
  try {
    raw = await readFile(PLAYERS_FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log(`Notice: ${displayPath} not found, nothing to validate.`);
      return 0;
    }
    throw err;
  }

  let players;
  try {
    players = JSON.parse(raw);
  } catch (err) {
    console.error(`${displayPath}: invalid JSON: ${err.message}`);
    return 1;
  }

  const errors = validatePlayers(players);
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    console.error(`${errors.length} problem(s) found in ${displayPath}.`);
    return 1;
  }

  console.log('OK');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
