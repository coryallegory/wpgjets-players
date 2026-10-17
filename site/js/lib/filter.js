import { normalizeText } from './text.js';

const ALL_ERAS = { wha: true, jets1: true, jets2: true };

/**
 * Keeps rows matching the search text (accent/case-insensitive substring of the name),
 * the GP toggle and the era toggles. `gp` on keeps players with at least one regular-season
 * or playoff game for a Jets franchise, who must have played in an active era; `gp` off keeps
 * players with no games (drafted, never played), who must have been drafted in an active era.
 * `eras` is { wha, jets1, jets2 }.
 */
export function filterRows(rows, { gp, eras = ALL_ERAS, query = '' }) {
  const needle = normalizeText(query);
  const inEra = (list) => (list ?? []).some((id) => eras[id]);
  return rows.filter((row) => {
    const hasPlayed = (row.playedEras ?? []).length > 0;
    const matchesGp = gp ? hasPlayed && inEra(row.playedEras) : !hasPlayed && inEra(row.draftedEras);
    return matchesGp && (needle === '' || normalizeText(row.searchText ?? row.name).includes(needle));
  });
}
