// Column order is the table order. `sortKey` is the row field compared when sorting;
// `type` decides numeric vs text comparison; `numeric` right-aligns the cell.
export const COLUMNS = [
  { id: 'name', label: 'Name', field: 'name', sortKey: 'name', type: 'text', locked: true },
  { id: 'rookieSeason', label: 'Rookie Season', field: 'rookieSeason', sortKey: 'rookieSeason', type: 'text' },
  // Never the missing marker: '?' (review link) when undecided, blank for never-played players.
  { id: 'rookieCard', label: 'Rookie Card', field: 'rookieCard', sortKey: 'rookieCardSort', type: 'text', blank: true },
  { id: 'position', label: 'Pos', field: 'position', sortKey: 'position', type: 'text' },
  { id: 'country', label: 'Country', field: 'country', sortKey: 'country', type: 'text' },
  // ISO "YYYY-MM-DD" is zero-padded, so it sorts chronologically as text.
  { id: 'birthDate', label: 'Birth Date', field: 'birthDate', sortKey: 'birthDate', type: 'text' },
  { id: 'nhlSeasons', label: 'NHL Seasons', field: 'nhlSeasonCount', sortKey: 'nhlSeasonCount', type: 'number' },
  // Season labels like "1981-82" sort correctly as text, so the span sorts by its first season.
  { id: 'nhlYears', label: 'NHL Years', field: 'nhlYearsLabel', sortKey: 'nhlFirstSeason', type: 'text' },
  { id: 'nhlRegularGP', label: 'NHL Reg GP', field: 'nhlRegularGP', sortKey: 'nhlRegularGP', type: 'number' },
  { id: 'nhlPlayoffGP', label: 'NHL Playoff GP', field: 'nhlPlayoffGP', sortKey: 'nhlPlayoffGP', type: 'number' },
  // WHA values are null (shown as the missing marker) for players without a WHA block.
  { id: 'whaSeasons', label: 'WHA Seasons', field: 'whaSeasonCount', sortKey: 'whaSeasonCount', type: 'number' },
  { id: 'whaYears', label: 'WHA Years', field: 'whaYearsLabel', sortKey: 'whaFirstSeason', type: 'text' },
  { id: 'whaRegularGP', label: 'WHA Reg GP', field: 'whaRegularGP', sortKey: 'whaRegularGP', type: 'number' },
  { id: 'whaPlayoffGP', label: 'WHA Playoff GP', field: 'whaPlayoffGP', sortKey: 'whaPlayoffGP', type: 'number' },
  { id: 'draftYear', label: 'NHL Draft Year', field: 'draftYear', sortKey: 'draftYear', type: 'number' },
  { id: 'draftTeam', label: 'NHL Draft Team', field: 'draftTeam', sortKey: 'draftTeam', type: 'text' },
  { id: 'round', label: 'NHL Draft Round', field: 'round', sortKey: 'round', type: 'number' },
  { id: 'overall', label: 'NHL Draft Pick', field: 'overall', sortKey: 'overall', type: 'number' },
  { id: 'amateur', label: 'Amateur Team', field: 'amateur', sortKey: 'amateur', type: 'text' },
].map((c) => ({ ...c, numeric: c.type === 'number' }));

/** Columns to show, in table order. `hidden` is a Set of column ids; locked columns are always shown. */
export function visibleColumns(columns, hidden) {
  return columns.filter((c) => c.locked || !hidden.has(c.id));
}

/** Parses a saved list of hidden column ids, keeping only known, hideable ones. Never throws. */
export function parseHidden(raw, columns) {
  let ids = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) ids = parsed;
  } catch {
    // missing or corrupt saved value: show every column
  }
  const hideable = new Set(columns.filter((c) => !c.locked).map((c) => c.id));
  return new Set(ids.filter((id) => hideable.has(id)));
}

export const DEFAULT_SORT = { columnId: 'name', direction: 'asc' };
