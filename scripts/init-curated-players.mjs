#!/usr/bin/env node
// One-time seeding of site/data/curated/players.json from temp/reference/nhl-jets.json.
// Refuses to overwrite an existing file unless --force is given.
// Usage: npm run init:players [-- --force]
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REFERENCE = resolve(ROOT, 'temp', 'reference', 'nhl-jets.json');
const OUT = resolve(ROOT, 'site', 'data', 'curated', 'players.json');

const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);

function amateur(draft) {
  if (!draft.amateurTeam) return null;
  return draft.amateurLeague ? `${draft.amateurTeam} (${draft.amateurLeague})` : draft.amateurTeam;
}

function curatedDraft(draft) {
  if (!draft) return null;
  return { year: draft.year, team: draft.team, round: draft.round, overall: draft.overall, amateur: amateur(draft) };
}

function curatedPlayer(p, retrieved) {
  const seasons = p.seasons.map(({ season, team, regularGP, playoffGP }) => ({ season, team, regularGP, playoffGP }));
  return {
    playerId: p.playerId,
    name: p.name,
    country: p.country,
    positions: [...new Set(p.positions)],
    rookieSeason: p.rookieSeason ?? null,
    jets: { regularGP: sum(seasons, 'regularGP'), playoffGP: sum(seasons, 'playoffGP'), seasons },
    draft: curatedDraft(p.draft),
    qualifiedBy: p.qualifiedBy,
    source: { site: 'nhl.com', definitive: true, retrieved },
  };
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const force = process.argv.includes('--force');
  if (!force && (await exists(OUT))) {
    console.error(`Refusing to overwrite existing ${OUT}. Curated data is not silently regenerated; pass --force to override.`);
    return 1;
  }
  const reference = JSON.parse(await readFile(REFERENCE, 'utf8'));
  const retrieved = reference.generatedAt.slice(0, 10);
  const players = reference.players.map((p) => curatedPlayer(p, retrieved));
  players.sort((a, b) => a.name.localeCompare(b.name) || a.playerId - b.playerId);
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(players, null, 2) + '\n');
  console.log(`Wrote ${players.length} players to ${OUT}`);
  return 0;
}

process.exitCode = await main();
