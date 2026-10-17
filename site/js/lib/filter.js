import { normalizeText } from './text.js';

const ALL_ERAS = { wha: true, jets1: true, jets2: true };

/**
 * Keeps rows matching the search text (accent/case-insensitive substring of the name)
 * and qualified by at least one active filter. `played` / `drafted` choose how a player
 * qualifies; `eras` ({ wha, jets1, jets2 }) choose the franchise eras that count. A player
 * matches when some active basis holds in some active era (e.g. Drafted + Jets 1.0 means
 * "drafted by the Jets 1.0 franchise"). With every era active the era check is skipped, so
 * nothing is hidden; with no basis or no era active nothing matches.
 */
export function filterRows(rows, { played, drafted, eras = ALL_ERAS, query = '' }) {
  const needle = normalizeText(query);
  const active = Object.keys(eras).filter((id) => eras[id]);
  const allEras = Object.keys(ALL_ERAS).every((id) => eras[id]);
  const inEra = (list) => (list ?? []).some((id) => active.includes(id));
  return rows.filter((row) => {
    const basis = (played && row.qualifiedBy.includes('played') && (allEras || inEra(row.playedEras))) ||
      (drafted && row.qualifiedBy.includes('drafted') && (allEras || inEra(row.draftedEras)));
    return basis && active.length > 0 && (needle === '' || normalizeText(row.searchText ?? row.name).includes(needle));
  });
}
