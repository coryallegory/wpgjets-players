import { normalizeText } from './text.js';

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

const isMissing = (v) => v === null || v === undefined || v === '';

function compareValues(a, b, type) {
  if (type === 'number') return a - b;
  return collator.compare(normalizeText(a), normalizeText(b));
}

/**
 * Returns a new array sorted by `column` ({ sortKey, type }) in `direction` ('asc' | 'desc').
 * Missing values always sort last, whichever the direction. Ties fall back to
 * name then playerId (always ascending) so the order is deterministic.
 */
export function sortRows(rows, column, direction) {
  const sign = direction === 'desc' ? -1 : 1;
  const tieBreak = (a, b) =>
    collator.compare(normalizeText(a.name), normalizeText(b.name)) || a.playerId - b.playerId;
  return [...rows].sort((a, b) => {
    const av = a[column.sortKey];
    const bv = b[column.sortKey];
    const aMissing = isMissing(av);
    const bMissing = isMissing(bv);
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
    if (!aMissing) {
      const c = compareValues(av, bv, column.type);
      if (c !== 0) return sign * c;
    }
    return tieBreak(a, b);
  });
}

/** Next sort state when a header is activated: same column flips direction, a new one starts ascending. */
export function nextSort(current, columnId) {
  if (current.columnId === columnId) {
    return { columnId, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { columnId, direction: 'asc' };
}
