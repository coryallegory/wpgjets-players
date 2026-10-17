// Column order is the table order. `sortKey` is the row field compared when sorting;
// `type` decides numeric vs text comparison; `numeric` right-aligns the cell.
export const COLUMNS = [
  { id: 'name', label: 'Name', field: 'name', sortKey: 'name', type: 'text' },
  { id: 'rookieSeason', label: 'Rookie Season', field: 'rookieSeason', sortKey: 'rookieSeason', type: 'text' },
  { id: 'position', label: 'Pos', field: 'position', sortKey: 'position', type: 'text' },
  { id: 'country', label: 'Country', field: 'country', sortKey: 'country', type: 'text' },
  { id: 'seasonCount', label: 'Jets Seasons', field: 'seasonCount', sortKey: 'seasonCount', type: 'number' },
  // Season labels like "1981-82" sort correctly as text, so the span sorts by its first season.
  { id: 'years', label: 'Jets Years', field: 'yearsLabel', sortKey: 'firstSeason', type: 'text' },
  { id: 'regularGP', label: 'Reg GP', field: 'regularGP', sortKey: 'regularGP', type: 'number' },
  { id: 'playoffGP', label: 'Playoff GP', field: 'playoffGP', sortKey: 'playoffGP', type: 'number' },
  { id: 'draftYear', label: 'Draft Year', field: 'draftYear', sortKey: 'draftYear', type: 'number' },
  { id: 'draftTeam', label: 'Draft Team', field: 'draftTeam', sortKey: 'draftTeam', type: 'text' },
  { id: 'round', label: 'Round', field: 'round', sortKey: 'round', type: 'number' },
  { id: 'overall', label: 'Pick', field: 'overall', sortKey: 'overall', type: 'number' },
  { id: 'amateur', label: 'Amateur Team', field: 'amateur', sortKey: 'amateur', type: 'text' },
].map((c) => ({ ...c, numeric: c.type === 'number' }));

export const DEFAULT_SORT = { columnId: 'name', direction: 'asc' };
