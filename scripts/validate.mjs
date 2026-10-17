// Validates site/data/curated/players.json if present. No dependencies.
// Usage: npm run validate

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

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Derived sortable display name: "Last, First" (just the last name when there is no first name). */
export const sortableName = (firstName, lastName) => (firstName ? `${lastName}, ${firstName}` : lastName);

const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';
const isCount = (v) => Number.isInteger(v) && v >= 0;

function checkJets(jets, add) {
  if (!isPlainObject(jets)) return add('jets must be an object');
  if (!isCount(jets.regularGP)) add('jets.regularGP must be a non-negative integer');
  if (!isCount(jets.playoffGP)) add('jets.playoffGP must be a non-negative integer');
  if (!Array.isArray(jets.seasons)) return add('jets.seasons must be an array');

  let regular = 0;
  let playoff = 0;
  let countsOk = true;
  for (const row of jets.seasons) {
    if (!isPlainObject(row)) {
      add('jets.seasons entries must be objects');
      countsOk = false;
      continue;
    }
    if (typeof row.season !== 'string' || !isValidSeason(row.season)) {
      add(`invalid season ${JSON.stringify(row.season)} (expected like "1990-91")`);
    }
    if (row.team !== 'WIN' && row.team !== 'WPG') {
      add(`invalid jets team ${JSON.stringify(row.team)} (expected WIN or WPG)`);
    }
    for (const key of ['regularGP', 'playoffGP']) {
      if (isCount(row[key])) continue;
      add(`season ${row.season}: ${key} must be a non-negative integer`);
      countsOk = false;
    }
    if (countsOk) {
      regular += row.regularGP;
      playoff += row.playoffGP;
    }
  }
  if (!countsOk) return;
  if (isCount(jets.regularGP) && jets.regularGP !== regular) {
    add(`jets.regularGP ${jets.regularGP} does not equal season sum ${regular}`);
  }
  if (isCount(jets.playoffGP) && jets.playoffGP !== playoff) {
    add(`jets.playoffGP ${jets.playoffGP} does not equal season sum ${playoff}`);
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
  const jets = player.jets;
  if (isPlainObject(jets) && isCount(jets.regularGP) && isCount(jets.playoffGP)) {
    const played = jets.regularGP + jets.playoffGP >= 1;
    if (q.includes('played') !== played) {
      add(played ? 'has Jets GP but qualifiedBy lacks "played"' : 'qualifiedBy has "played" but Jets GP is 0');
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
    if (!Array.isArray(player.positions) || !player.positions.every(isNonEmptyString)) {
      add('positions must be an array of non-empty strings');
    }
    if (player.rookieSeason !== null && (typeof player.rookieSeason !== 'string' || !isValidSeason(player.rookieSeason))) {
      add(`invalid rookieSeason ${JSON.stringify(player.rookieSeason)} (expected null or like "1990-91")`);
    }
    checkJets(player.jets, add);
    checkDraft(player.draft === undefined ? 'missing' : player.draft, add);
    checkQualifiedBy(player, add);

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
