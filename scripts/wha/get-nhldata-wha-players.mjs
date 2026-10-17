#!/usr/bin/env node
// Looks up official NHL player ids for the WHA-only Jets players (the reserved 900001+ ids in
// data/decisions/wha-ids.json), so players who also had an NHL career can use their real NHL id.
// Output: temp/reference/nhl-wha-lookup.json (reference data, never hand-edit).
//
// Official NHL endpoints only:
//   search   https://search.d3.nhle.com/api/v1/search/player?q={name}
//   landing  https://api-web.nhle.com/v1/player/{id}/landing   (birthDate, country, draftDetails, seasonTotals)
//   draft    https://records.nhl.com/site/api/draft?cayenneExp=playerId={id}   (amateur club for pre-1979 drafts)
// Responses are cached in temp/cache/nhl/ (re-runs are network-free; --refresh re-fetches).
//
// Matching (never on names alone): a candidate is ACCEPTED only when, after diacritic folding, its
// last name equals ours, its landing birthDate equals our curated birthDate (or an alternate date
// the owner already recorded in a resolved birthdate decision, e.g. Labraaten's nhl.com 1951-09-05),
// its first name is compatible (nickname groups), and it is the only such candidate. Accepted
// players with >= 1 NHL game get status "matched"; an exact NHL record without NHL games keeps the
// reserved id ("nhl-record-no-nhl-games"). Same-surname candidates with a near birth date (same
// year, <= 60 days apart, or day/month swapped), several exact candidates, or an exact birth date
// with an incompatible first name become REVIEW candidates; scripts/wha/reconcile-wha.mjs turns them
// into decision items `nhlid:{key}:{nhlPlayerId}` (resolve in data/decisions/wha-decisions.json).
//
// Usage: npm run get:nhl-wha [-- --refresh]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WEB, SEARCH, getJson, mapLimit, rookieSeason, firstLeagueSeason } from '../get-nhldata-jets.mjs';
import { normName, namesCompatible, indexDecisions } from './reconcile-wha.mjs';
import { parseCareerSeasons, firstCareerSeason } from './get-hockeyreference-wha.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PATHS = {
  ids: resolve(ROOT, 'data', 'decisions', 'wha-ids.json'),
  decisions: resolve(ROOT, 'data', 'decisions', 'wha-decisions.json'),
  variants: resolve(ROOT, 'data', 'decisions', 'name-variants.json'),
  players: resolve(ROOT, 'site', 'data', 'curated', 'players.json'),
  hr: resolve(ROOT, 'temp', 'reference', 'hockeyreference-wha-jets.json'),
  db: resolve(ROOT, 'temp', 'reference', 'hockeydb-wha-jets.json'),
  hrCache: resolve(ROOT, 'temp', 'cache', 'hockeyreference'),
  cache: resolve(ROOT, 'temp', 'cache', 'nhl'),
  out: resolve(ROOT, 'temp', 'reference', 'nhl-wha-lookup.json'),
};
const RECORDS_DRAFT = 'https://records.nhl.com/site/api/draft';
export const LANDING_URL = (id) => `${WEB}/player/${id}/landing`;
const NEAR_DAYS = 60;

// ---------------------------------------------------------------- pure helpers

const days = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;

/** 'equal' | 'alternate' | 'near' | 'different' | 'missing' for a landing birth date vs ours. */
export function birthRelation(ours, theirs, alternates = []) {
  if (!ours || !theirs) return 'missing';
  if (ours === theirs) return 'equal';
  if (alternates.includes(theirs)) return 'alternate';
  const swapped = ours.slice(0, 4) === theirs.slice(0, 4) && ours.slice(5, 7) === theirs.slice(8, 10) && ours.slice(8, 10) === theirs.slice(5, 7);
  if (ours.slice(0, 4) === theirs.slice(0, 4) || swapped || Math.abs(days(ours) - days(theirs)) <= NEAR_DAYS) return 'near';
  return 'different';
}

/** ISO dates mentioned in the notes of the owner's resolved birthdate decision(s) for a source key. */
export function decisionAlternates(decisions, key) {
  const d = decisions.get(`birthdate:${key}`);
  return d?.note ? [...new Set(d.note.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [])] : [];
}

/** NHL games (regular + playoffs) from landing seasonTotals. */
export function nhlGames(landing) {
  return (landing.seasonTotals ?? [])
    .filter((t) => t.leagueAbbrev === 'NHL' && (t.gameTypeId === 2 || t.gameTypeId === 3))
    .reduce((n, t) => n + (t.gamesPlayed ?? 0), 0);
}

/**
 * Classifies one candidate landing against our player.
 * @param {{ lastNames: string[], nameRecords: object[], birthDate: string, alternates: string[] }} ours
 */
export function classifyCandidate(ours, landing) {
  const last = landing.lastName?.default ?? '';
  const surnameOk = ours.lastNames.some((n) => normName(n) === normName(last));
  const birth = birthRelation(ours.birthDate, landing.birthDate ?? null, ours.alternates);
  const firstOk = ours.nameRecords.some((r) => namesCompatible(r, { firstName: landing.firstName?.default ?? '' }));
  const exact = surnameOk && (birth === 'equal' || birth === 'alternate') && firstOk;
  let review = null;
  if (surnameOk && (birth === 'equal' || birth === 'alternate') && !firstOk) review = 'birth date and surname agree but first names are not nickname-compatible';
  else if (surnameOk && birth === 'near' && firstOk) review = 'same surname and compatible first name; birth date differs slightly (possible typo)';
  else if (surnameOk && birth === 'missing' && firstOk) review = 'same surname and compatible first name; a birth date is missing';
  return { surnameOk, birth, firstOk, exact, review };
}

/**
 * Decides the lookup status from classified candidates:
 * matched | nhl-record-no-nhl-games | review | not-found.
 */
export function decide(candidates) {
  const exact = candidates.filter((c) => c.exact);
  const review = candidates.filter((c) => c.review);
  if (exact.length === 1 && !review.length) return { status: exact[0].nhlGames > 0 ? 'matched' : 'nhl-record-no-nhl-games', chosen: exact[0] };
  if (exact.length > 1) return { status: 'review', reason: 'several exact candidates', review: exact };
  if (exact.length === 1 || review.length) {
    return { status: 'review', reason: exact.length ? 'one exact candidate plus near candidates' : 'only near candidates', review: [...exact, ...review] };
  }
  return { status: 'not-found' };
}

/** Curated draft shape from landing draftDetails + records.nhl.com draft rows (for the amateur club). */
export function draftFrom(landing, records = []) {
  const d = landing.draftDetails;
  if (!d) return null;
  const r = records.find((x) => x.draftYear === d.year && x.overallPickNumber === d.overallPick) ?? null;
  const amateur = r?.amateurClubName ? (r.amateurLeague ? `${r.amateurClubName} (${r.amateurLeague})` : r.amateurClubName) : null;
  return { year: d.year, team: d.teamAbbrev, round: d.round ?? r?.roundNumber ?? null, overall: d.overallPick, amateur };
}

// ---------------------------------------------------------------- cached fetching

const refresh = process.argv.includes('--refresh');
const safe = (s) => s.replace(/[^a-z0-9]+/gi, '_').toLowerCase();

async function cached(kind, name, url) {
  const file = resolve(PATHS.cache, kind, `${safe(name)}.json`);
  if (!refresh) {
    try { return JSON.parse(await readFile(file, 'utf8')); } catch { /* not cached */ }
  }
  const json = await getJson(url);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(json));
  return json;
}
const search = (q) => cached('search', q, `${SEARCH}?culture=en-us&limit=100&q=${encodeURIComponent(q)}`);
const landingOf = (id) => cached('landing', String(id), LANDING_URL(id));
const draftRows = async (id) => (await cached('draft', String(id), `${RECORDS_DRAFT}?cayenneExp=playerId=${id}`)).data ?? [];

// ---------------------------------------------------------------- main

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (err) {
    if (fallback !== undefined && err.code === 'ENOENT') return fallback;
    throw new Error(`get-nhldata-wha-players: cannot read ${file}: ${err.message}`);
  }
}

async function hrCareer(hrId) {
  if (!hrId) return null;
  try {
    return parseCareerSeasons(await readFile(resolve(PATHS.hrCache, `player_${hrId}.html`), 'utf8'));
  } catch { return null; }
}

async function lookupOne(a, ctx) {
  const currentId = a.retiredFor?.nhlPlayerId ?? a.playerId;
  const p = ctx.players.get(currentId);
  if (!p) throw new Error(`wha-ids.json ${a.key} (${currentId}) is not in players.json`);
  const [kind, sid] = [a.key.slice(0, 2), a.key.slice(3)];
  const hrId = kind === 'hr' ? sid : null;
  const hr = hrId ? ctx.hr.get(hrId) : null;
  const db = ctx.db.get(p.wha?.source?.hockeydbId ?? (kind === 'db' ? sid : null)) ?? null;
  const variantNames = [...(ctx.variants.get(a.playerId) ?? []), ...(ctx.variants.get(currentId) ?? [])];
  const nameRecords = [p, hr, db, ...variantNames.map((v) => ({ firstName: v.split(/\s+/)[0] }))].filter(Boolean);
  const lastNames = [...new Set([p.lastName, hr?.lastName, db?.lastName, ...variantNames.map((v) => v.trim().split(/\s+/).at(-1))].filter(Boolean))];
  const ours = { lastNames, nameRecords, birthDate: p.birthDate, alternates: decisionAlternates(ctx.decisions, a.key) };

  const queries = [...new Set([`${p.firstName} ${p.lastName}`, ...lastNames, ...variantNames, hr?.name, db?.name].filter(Boolean))];
  const hits = new Map();
  for (const q of queries) for (const h of await search(q)) hits.set(String(h.playerId), h);
  const folded = lastNames.map(normName);
  const plausible = [...hits.values()].filter((h) => folded.some((n) => normName(h.name).includes(n)));

  const candidates = [];
  for (const h of plausible) {
    const landing = await landingOf(h.playerId);
    const c = classifyCandidate(ours, landing);
    if (!c.surnameOk) continue;
    candidates.push({
      nhlPlayerId: Number(h.playerId),
      name: `${landing.firstName?.default ?? ''} ${landing.lastName?.default ?? ''}`.trim(),
      birthDate: landing.birthDate ?? null,
      birthCountry: landing.birthCountry ?? null,
      nhlGames: nhlGames(landing),
      ...c,
      landingUrl: LANDING_URL(h.playerId),
      landing,
    });
  }
  candidates.sort((x, y) => x.nhlPlayerId - y.nhlPlayerId);
  // Facts for every candidate the owner might accept (exact or review), so a decision needs no re-run.
  for (const c of candidates.filter((x) => x.exact || x.review)) {
    Object.assign(c, {
      draft: c.landing.draftDetails ? draftFrom(c.landing, await draftRows(c.nhlPlayerId)) : null,
      firstNhlSeason: firstLeagueSeason(c.landing, 'NHL'),
      firstWhaSeason: firstLeagueSeason(c.landing, 'WHA'),
      rookieSeason: rookieSeason(c.landing),
    });
  }
  const d = decide(candidates);
  const career = await hrCareer(hrId);
  const hrInfo = career ? {
    firstWhaSeason: firstCareerSeason(career, ['WHA']),
    firstNhlSeason: firstCareerSeason(career, ['NHL']),
    nhlGames: career.filter((r) => r.league === 'NHL').reduce((n, r) => n + r.regularGP + r.playoffGP, 0),
  } : null;

  const strip = ({ landing, ...c }) => c;
  const entry = {
    key: a.key,
    reservedId: a.playerId,
    currentPlayerId: currentId,
    name: p.name,
    birthDate: p.birthDate,
    country: p.country ?? null,
    alternates: ours.alternates,
    queries,
    status: d.status,
    hockeyReference: hrInfo,
    candidates: candidates.filter((c) => c.exact || c.review || c.birth === 'near').map(strip),
    otherSameSurname: candidates.filter((c) => !(c.exact || c.review || c.birth === 'near')).length,
  };
  if (d.status === 'review') entry.reviewReason = d.reason;
  if (d.chosen) {
    const L = d.chosen.landing;
    Object.assign(entry, {
      nhlPlayerId: d.chosen.nhlPlayerId,
      landingUrl: d.chosen.landingUrl,
      basis: d.chosen.birth === 'equal' ? 'birthDate+lastName+firstName' : 'decisionAlternateBirthDate+lastName+firstName',
      landing: {
        firstName: L.firstName?.default ?? null, lastName: L.lastName?.default ?? null,
        birthDate: L.birthDate ?? null, birthCountry: L.birthCountry ?? null, draftDetails: L.draftDetails ?? null,
      },
      draft: d.chosen.draft,
      firstNhlSeason: d.chosen.firstNhlSeason,
      firstWhaSeason: d.chosen.firstWhaSeason,
      rookieSeason: d.chosen.rookieSeason,
      nhlGames: d.chosen.nhlGames,
    });
  }
  // Cross-check against Hockey-Reference's career table (warnings only).
  const warnings = [];
  if (hrInfo?.nhlGames > 0 && d.status !== 'matched') warnings.push(`Hockey-Reference lists ${hrInfo.nhlGames} NHL games but no NHL id was accepted (${d.status})`);
  if (d.status === 'matched' && hrInfo && hrInfo.nhlGames === 0) warnings.push('accepted NHL id but Hockey-Reference lists no NHL games');
  if (d.status === 'matched' && hrInfo?.firstNhlSeason && hrInfo.firstNhlSeason !== entry.firstNhlSeason) warnings.push(`first NHL season: nhl.com ${entry.firstNhlSeason}, Hockey-Reference ${hrInfo.firstNhlSeason}`);
  if (d.status === 'matched' && entry.landing.birthCountry && p.country && entry.landing.birthCountry !== p.country) warnings.push(`country: nhl.com ${entry.landing.birthCountry}, curated ${p.country}`);
  if (warnings.length) entry.warnings = warnings;
  return entry;
}

async function main() {
  const ids = await readJson(PATHS.ids);
  const decisions = indexDecisions(await readJson(PATHS.decisions, { decisions: [] }));
  const players = new Map((await readJson(PATHS.players)).map((p) => [p.playerId, p]));
  const hr = new Map((await readJson(PATHS.hr)).players.map((r) => [r.sourceId, r]));
  const db = new Map((await readJson(PATHS.db)).players.map((r) => [r.sourceId, r]));
  const variants = new Map();
  for (const v of (await readJson(PATHS.variants, { variants: [] })).variants) variants.set(v.playerId, [...(variants.get(v.playerId) ?? []), ...v.variants]);
  const ctx = { players, hr, db, decisions, variants };

  const entries = await mapLimit(ids.assignments, (a) => lookupOne(a, ctx));
  const count = (s) => entries.filter((e) => e.status === s).length;
  const output = {
    generatedAt: new Date().toISOString(),
    sourceNotes:
      'Official NHL endpoints only (search.d3.nhle.com player search, api-web.nhle.com player landing, records.nhl.com draft). ' +
      'One entry per reserved WHA-only id in data/decisions/wha-ids.json. matched = unique candidate with equal folded last name, ' +
      'equal birth date (or an alternate recorded in a resolved owner birthdate decision), compatible first name and >= 1 NHL game. ' +
      'rookieSeason/firstNhlSeason/firstWhaSeason are first regular seasons from landing seasonTotals.',
    stats: { players: entries.length, matched: count('matched'), review: count('review'), noNhlGames: count('nhl-record-no-nhl-games'), notFound: count('not-found') },
    players: entries,
  };
  await mkdir(dirname(PATHS.out), { recursive: true });
  await writeFile(PATHS.out, JSON.stringify(output, null, 2) + '\n');
  console.log(`matched ${output.stats.matched}, review ${output.stats.review}, NHL record without NHL games ${output.stats.noNhlGames}, not found ${output.stats.notFound} (of ${entries.length})`);
  for (const e of entries) {
    if (e.status === 'matched') console.log(`  = ${e.name} ${e.reservedId} -> ${e.nhlPlayerId} (${e.birthDate}; ${e.basis}; rookie ${e.rookieSeason})`);
    if (e.status === 'review') console.log(`  ? ${e.name} (${e.birthDate}): ${e.reviewReason}: ${e.candidates.filter((c) => c.exact || c.review).map((c) => `${c.nhlPlayerId} ${c.name} ${c.birthDate}`).join('; ')}`);
    for (const w of e.warnings ?? []) console.log(`  ! ${e.name}: ${w}`);
  }
  console.log(`Wrote ${PATHS.out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => { console.error(`ERROR: ${err.message}`); process.exit(1); });
}

