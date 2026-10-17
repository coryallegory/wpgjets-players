#!/usr/bin/env node
// Collects every player who played for, or was drafted by, a Winnipeg Jets
// franchise (Jets 1.0 = WIN, Jets 2.0 = WPG) from official NHL APIs.
// Output: temp/reference/nhl-jets.json (reference data, never hand-edit).
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = 'https://api-web.nhle.com/v1';
const SEARCH = 'https://search.d3.nhle.com/api/v1/search/player';
const JETS_TEAMS = ['WIN', 'WPG'];
const GAME_TYPES = { 2: 'regularGP', 3: 'playoffGP' };
const FIRST_DRAFT_YEAR = 1979;
const CONCURRENCY = 5;
const RETRIES = 4;
const TIMEOUT_MS = 20000;
// The NHL edge returns 429 to fetch's default user agent.
const USER_AGENT = 'wpgjets-players-tracker/1.0 (personal project)';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'temp', 'reference', 'nhl-jets.json');

const log = (msg) => console.log(msg);

async function getJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
      if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw new Error(`Request failed after ${RETRIES} attempts: ${url} (${lastError.message})`);
}

// Runs fn over items with bounded concurrency, preserving order.
async function mapLimit(items, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return results;
}

const seasonLabel = (n) => `${String(n).slice(0, 4)}-${String(n).slice(6)}`;
const fullName = (o) => `${o.firstName.default} ${o.lastName.default}`.trim();

// --- Played: club-stats per team/season/game type ---------------------------

async function collectPlayed(used) {
  const played = new Map(); // playerId -> { name, seasons: Map }
  for (const team of JETS_TEAMS) {
    const url = `${WEB}/club-stats-season/${team}`;
    used.add(`${WEB}/club-stats-season/{team}`);
    const seasons = await getJson(url);
    const jobs = seasons.flatMap((s) =>
      s.gameTypes.filter((t) => GAME_TYPES[t]).map((t) => ({ team, season: s.season, type: t })),
    );
    await mapLimit(jobs, async ({ team, season, type }) => {
      used.add(`${WEB}/club-stats/{team}/{season}/{gameType}`);
      const stats = await getJson(`${WEB}/club-stats/${team}/${season}/${type}`);
      const rows = [
        ...stats.skaters.map((p) => [p, p.positionCode]),
        ...stats.goalies.map((p) => [p, 'G']),
      ];
      for (const [p, position] of rows) {
        if (!(p.gamesPlayed >= 1)) continue;
        const entry = played.get(p.playerId) ?? { seasons: new Map() };
        const key = `${season}|${team}`;
        const row = entry.seasons.get(key) ?? {
          season: seasonLabel(season), team, regularGP: 0, playoffGP: 0, position,
        };
        row[GAME_TYPES[type]] += p.gamesPlayed;
        entry.seasons.set(key, row);
        played.set(p.playerId, entry);
      }
    });
    log(`${team}: ${seasons.length} seasons scanned`);
  }
  return played;
}

// --- Drafts: all picks, indexed by year-overall -----------------------------

async function collectDraftPicks(used) {
  used.add(`${WEB}/draft/picks/{year}/all`);
  const { draftYears } = await getJson(`${WEB}/draft/picks/now`);
  const drafts = await mapLimit(draftYears, (year) => getJson(`${WEB}/draft/picks/${year}/all`));
  const picks = new Map();
  drafts.forEach((d, i) => {
    for (const p of d.picks) picks.set(`${draftYears[i]}-${p.overallPick}`, { year: draftYears[i], ...p });
  });
  log(`Draft picks indexed: ${picks.size} across ${draftYears.length} drafts`);
  return picks;
}

const jetsPick = (p) => JETS_TEAMS.includes(p.teamAbbrev);

function draftRecord(pick) {
  return {
    year: pick.year,
    team: pick.teamAbbrev,
    round: pick.round ?? null,
    overall: pick.overallPick,
    amateurTeam: pick.amateurClubName || null,
  };
}

// The draft-picks endpoint starts at 1979; earlier drafts (never Jets picks) fall back to landing data.
function findPick(picks, d, id) {
  const pick = picks.get(`${d.year}-${d.overallPick}`);
  if (pick) return pick;
  if (d.year >= FIRST_DRAFT_YEAR) throw new Error(`No draft pick found for player ${id} (${d.year} #${d.overallPick})`);
  return { year: d.year, teamAbbrev: d.teamAbbrev, round: d.round, overallPick: d.overallPick };
}

// --- Player lookup ----------------------------------------------------------

const getLanding = (id, used) => {
  used.add(`${WEB}/player/{playerId}/landing`);
  return getJson(`${WEB}/player/${id}/landing`);
};

// Drafted players who never played have no club-stats entry, so their ID comes
// from NHL player search, accepted only if the landing draftDetails agree.
async function resolveDraftedId(pick, used) {
  used.add(`${SEARCH}?q={name}`);
  // Full-name search sometimes misses (e.g. Jan Kostalek), so fall back to surname.
  for (const query of [fullName(pick), pick.lastName.default]) {
    const hits = await getJson(`${SEARCH}?culture=en-us&limit=20&q=${encodeURIComponent(query)}`);
    for (const hit of hits) {
      const landing = await getLanding(hit.playerId, used);
      const d = landing.draftDetails;
      if (d && d.year === pick.year && d.overallPick === pick.overallPick) return { id: Number(hit.playerId), landing };
    }
  }
  return null;
}

// --- Assembly ---------------------------------------------------------------

function buildPlayer(id, landing, seasons, pick, qualifiedBy, used) {
  return {
    playerId: id,
    name: fullName(landing),
    country: landing.birthCountry ?? null,
    positions: [...new Set(seasons.map((s) => s.position))],
    seasons,
    draft: pick ? draftRecord(pick) : null,
    source: { site: 'nhl.com', endpoints: [...used].sort() },
    qualifiedBy,
  };
}

async function main() {
  const used = new Set();
  const played = await collectPlayed(used);
  log(`Players with GP>=1: ${played.size}`);
  const picks = await collectDraftPicks(used);

  const playedIds = [...played.keys()];
  const landings = await mapLimit(playedIds, (id) => getLanding(id, used));
  const byId = new Map(); // id -> { landing, seasons, pick, qualifiedBy }
  playedIds.forEach((id, i) => {
    const d = landings[i].draftDetails;
    const pick = d ? findPick(picks, d, id) : null;
    const qualifiedBy = ['played'];
    if (pick && jetsPick(pick)) qualifiedBy.push('drafted');
    const seasons = [...played.get(id).seasons.values()].sort(
      (a, b) => a.season.localeCompare(b.season) || a.team.localeCompare(b.team),
    );
    byId.set(id, { landing: landings[i], seasons, pick, qualifiedBy });
  });

  const jetsPicks = [...picks.values()].filter(jetsPick);
  const claimed = new Set([...byId.values()].filter((e) => e.pick && jetsPick(e.pick)).map((e) => `${e.pick.year}-${e.pick.overallPick}`));
  const unclaimed = jetsPicks.filter((p) => !claimed.has(`${p.year}-${p.overallPick}`));
  log(`Jets picks: ${jetsPicks.length}; ${unclaimed.length} not matched to a player who played for the Jets`);

  const resolved = await mapLimit(unclaimed, (pick) => resolveDraftedId(pick, used));
  const unresolved = [];
  unclaimed.forEach((pick, i) => {
    if (!resolved[i]) return unresolved.push(pick);
    const { id, landing } = resolved[i];
    if (byId.has(id)) throw new Error(`Duplicate player ${id} for pick ${pick.year} #${pick.overallPick}`);
    byId.set(id, { landing, seasons: [], pick, qualifiedBy: ['drafted'] });
  });
  if (unresolved.length) {
    const list = unresolved.map((p) => `${p.year} #${p.overallPick} ${fullName(p)} (${p.teamAbbrev})`).join('\n  ');
    throw new Error(`Could not resolve an NHL player ID for ${unresolved.length} Jets draft picks:\n  ${list}`);
  }

  const players = [...byId].map(([id, e]) => buildPlayer(id, e.landing, e.seasons, e.pick, e.qualifiedBy, used));
  players.sort((a, b) => a.name.localeCompare(b.name) || a.playerId - b.playerId);

  const output = {
    generatedAt: new Date().toISOString(),
    sourceNotes:
      'Official NHL APIs only. Played: api-web club-stats (WIN 1979-96, WPG 2011-), GP>=1 in regular season or playoffs. ' +
      'Drafted: api-web draft picks where the pick-holding team is WIN or WPG (Atlanta excluded); player IDs for ' +
      'never-played picks resolved via NHL player search and verified against landing draftDetails. WHA excluded.',
    players,
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(output, null, 2) + '\n');
  log(`Wrote ${players.length} players to ${OUT}`);
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
