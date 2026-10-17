export const MISSING = '–'; // en dash
const RANGE_SEPARATOR = ' – ';

/** Display text for a possibly-missing value. */
export function display(value) {
  return value === null || value === undefined || value === '' ? MISSING : String(value);
}

/** "1981-82" or "1981-82 – 1989-90"; null when there are no seasons. */
export function yearsLabel(first, last) {
  if (!first || !last) return null;
  return first === last ? first : `${first}${RANGE_SEPARATOR}${last}`;
}

/** Franchise eras, in table order. `id` is the key used by rows and filters. */
export const ERAS = [
  { id: 'wha', label: 'Jets WHA' },
  { id: 'jets1', label: 'Jets 1.0' },
  { id: 'jets2', label: 'Jets 2.0' },
];

const NHL_TEAM_ERA = { WIN: 'jets1', WPG: 'jets2' };

const hasGames = (s) => s.regularGP + s.playoffGP > 0;

/** Eras (in ERAS order) in which the player has a regular-season or playoff game for the Jets. */
function playedEras(player) {
  const found = new Set();
  if ((player.wha?.seasons ?? []).some(hasGames)) found.add('wha');
  for (const s of player.nhl?.seasons ?? []) if (hasGames(s) && NHL_TEAM_ERA[s.team]) found.add(NHL_TEAM_ERA[s.team]);
  return ERAS.map((e) => e.id).filter((id) => found.has(id));
}

/** Eras the player was drafted in (WHA drafts are out of scope, so never 'wha'). */
function draftedEras(player) {
  const era = NHL_TEAM_ERA[player.draft?.team];
  return era ? [era] : [];
}

const seasonList = (block) => [...new Set((block?.seasons ?? []).map((s) => s.season))].sort();

/** Tooltip text for a flagged value: the player's notes when present, else a generic message. */
export function reviewTitle(player) {
  const notes = (player.notes ?? []).filter(Boolean);
  return `Needs review: ${notes.length ? notes.join(' ') : 'this value is provisional.'}`;
}

/**
 * Flattens a curated player into the plain values the table shows and sorts on.
 * Missing values are null. NHL values are 0 when there are no NHL Jets games (a missing
 * `nhl` block is treated the same; the validator is what reports it). WHA values are null
 * when the player has no `wha` block. `flags` maps a needsReview field name to its tooltip.
 */
export function toRow(player) {
  const nhlSeasons = seasonList(player.nhl);
  const wha = player.wha ?? null;
  const whaSeasons = seasonList(wha);
  const draft = player.draft;
  const flags = {};
  for (const field of player.needsReview ?? []) flags[field] = reviewTitle(player);
  return {
    playerId: player.playerId,
    name: player.name,
    // Both orders, so "dale haw" and "hawerchuk, d" both match.
    searchText: `${player.firstName} ${player.lastName} ${player.name}`,
    rookieSeason: player.rookieSeason ?? null,
    position: player.positions?.length ? player.positions.join('/') : null,
    country: player.country ?? null,
    birthDate: player.birthDate ?? null,
    nhlSeasonCount: nhlSeasons.length,
    nhlFirstSeason: nhlSeasons[0] ?? null,
    nhlYearsLabel: yearsLabel(nhlSeasons[0], nhlSeasons[nhlSeasons.length - 1]),
    nhlRegularGP: player.nhl?.regularGP ?? 0,
    nhlPlayoffGP: player.nhl?.playoffGP ?? 0,
    whaSeasonCount: wha ? whaSeasons.length : null,
    whaFirstSeason: whaSeasons[0] ?? null,
    whaYearsLabel: yearsLabel(whaSeasons[0], whaSeasons[whaSeasons.length - 1]),
    whaRegularGP: wha ? wha.regularGP ?? 0 : null,
    whaPlayoffGP: wha ? wha.playoffGP ?? 0 : null,
    draftYear: draft?.year ?? null,
    draftTeam: draft?.team ?? null,
    round: draft?.round ?? null,
    overall: draft?.overall ?? null,
    amateur: draft?.amateur ?? null,
    flags,
    qualifiedBy: player.qualifiedBy ?? [],
    playedEras: playedEras(player),
    draftedEras: draftedEras(player),
  };
}
