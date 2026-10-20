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

export const NO_CARD = 'No card';
export const UNDECIDED = '?';
/** Private review page (artifact); opened on a player with #<playerId>. Keep the artifact unshared. */
export const REVIEW_URL = 'https://claude.ai/artifact/6g5d3cabDjNxQmxiH7KXy8';

/** "2011-12 Upper Deck Young Guns #248" from a chosen card (the set's leading year is dropped). */
export function cardLabel(card) {
  if (!card) return null;
  const set = String(card.set ?? '').replace(/^\d{4}\s+/, '');
  const parts = [card.season, set];
  if (card.subset && !set.includes(card.subset)) parts.push(card.subset);
  const label = parts.filter(Boolean).join(' ');
  return card.cardNumber ? `${label} #${card.cardNumber}` : label;
}

/** Reference link of a chosen card: SportsCardsPro first, else COMC; null if none or not https. */
export function cardUrl(card) {
  const url = card?.urls?.scp ?? card?.urls?.comc ?? null;
  return typeof url === 'string' && url.startsWith('https://') ? url : null;
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
 * when the player has no `wha` block. `rookieCard` is the card label, 'No card' for an explicit
 * no-card decision, '?' (links to the review page) when undecided but the player has Jets games,
 * and null (blank) for never-played players. `rookieCardSort` is null whenever undecided. `flags` maps a needsReview field name to its tooltip.
 */
export function toRow(player, cardRecord = null) {
  const nhlSeasons = seasonList(player.nhl);
  const wha = player.wha ?? null;
  const whaSeasons = seasonList(wha);
  const draft = player.draft;
  const flags = {};
  const decided = cardRecord?.status === 'chosen' || cardRecord?.status === 'no-card';
  const played = playedEras(player).length > 0;
  for (const field of player.needsReview ?? []) flags[field] = reviewTitle(player);
  return {
    playerId: player.playerId,
    name: player.name,
    // Both orders, so "dale haw" and "hawerchuk, d" both match.
    searchText: `${player.firstName} ${player.lastName} ${player.name}`,
    rookieSeason: player.rookieSeason ?? null,
    rookieCardSort: decided ? (cardRecord.status === 'chosen' ? cardLabel(cardRecord.chosen) : NO_CARD) : null,
    rookieCard: decided ? (cardRecord.status === 'chosen' ? cardLabel(cardRecord.chosen) : NO_CARD) : played ? UNDECIDED : null,
    rookieCardUrl: decided ? (cardRecord.status === 'chosen' ? cardUrl(cardRecord.chosen) : null) : played ? `${REVIEW_URL}#${player.playerId}` : null,
    rookieCardReview: !decided && played,
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
