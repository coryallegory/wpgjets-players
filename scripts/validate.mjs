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
    if (typeof id !== 'number' || !Number.isFinite(id)) {
      errors.push(`${label}: playerId must be a number`);
    } else if (seenIds.has(id)) {
      errors.push(`${label}: duplicate playerId ${id}`);
    } else {
      seenIds.add(id);
    }

    const itemLabel = typeof id === 'number' ? `${label} (playerId ${id})` : label;

    if (typeof player.name !== 'string' || player.name.trim() === '') {
      errors.push(`${itemLabel}: name must be a non-empty string`);
    }

    if (!Array.isArray(player.seasons)) {
      errors.push(`${itemLabel}: seasons must be an array`);
    } else {
      for (const season of player.seasons) {
        if (typeof season !== 'string' || !isValidSeason(season)) {
          errors.push(`${itemLabel}: invalid season ${JSON.stringify(season)} (expected like "1990-91")`);
        }
      }
    }

    if (!isPlainObject(player.source)) {
      errors.push(`${itemLabel}: source must be an object`);
    } else if (typeof player.source.site !== 'string' || player.source.site.trim() === '') {
      errors.push(`${itemLabel}: source.site must be a non-empty string`);
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
