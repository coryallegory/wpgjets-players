// Column order is the table order. `sortKey` is the row field compared when sorting;
// `type` decides numeric vs text comparison; `numeric` right-aligns the cell.
export const COLUMNS = [
  { id: 'name', label: 'Name', field: 'name', sortKey: 'name', type: 'text' },
  { id: 'rookieSeason', label: 'Rookie Season', field: 'rookieSeason', sortKey: 'rookieSeason', type: 'text' },
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

export const DEFAULT_SORT = { columnId: 'name', direction: 'asc' };
