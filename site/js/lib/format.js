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

/**
 * Flattens a curated player into the plain values the table shows and sorts on.
 * Missing values are null.
 */
export function toRow(player) {
  const seasons = [...new Set(player.jets.seasons.map((s) => s.season))].sort();
  const draft = player.draft;
  return {
    playerId: player.playerId,
    name: player.name,
    // Both orders, so "dale haw" and "hawerchuk, d" both match.
    searchText: `${player.firstName} ${player.lastName} ${player.name}`,
    rookieSeason: player.rookieSeason ?? null,
    position: player.positions.length ? player.positions.join('/') : null,
    country: player.country ?? null,
    seasonCount: seasons.length,
    firstSeason: seasons[0] ?? null,
    yearsLabel: yearsLabel(seasons[0], seasons[seasons.length - 1]),
    regularGP: player.jets.regularGP,
    playoffGP: player.jets.playoffGP,
    draftYear: draft?.year ?? null,
    draftTeam: draft?.team ?? null,
    round: draft?.round ?? null,
    overall: draft?.overall ?? null,
    amateur: draft?.amateur ?? null,
    qualifiedBy: player.qualifiedBy,
  };
}
