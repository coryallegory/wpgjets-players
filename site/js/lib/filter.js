import { normalizeText } from './text.js';

/**
 * Keeps rows matching the search text (accent/case-insensitive substring of the name)
 * and qualified by at least one active filter. `filters` is { played, drafted };
 * with neither active nothing matches.
 */
export function filterRows(rows, { played, drafted, query = '' }) {
  const needle = normalizeText(query);
  return rows.filter((row) => {
    const qualifies =
      (played && row.qualifiedBy.includes('played')) || (drafted && row.qualifiedBy.includes('drafted'));
    return qualifies && (needle === '' || normalizeText(row.searchText ?? row.name).includes(needle));
  });
}
