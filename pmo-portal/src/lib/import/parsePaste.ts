import { ImportParseError, MAX_IMPORT_ROWS, type ParsedSheet } from './types';

/** Split spreadsheet-copied text (tab-separated, optional "quoted" cells that may hold tabs/newlines) into a grid. */
function splitGrid(text: string): string[][] {
  const grid: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      grid.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); grid.push(row); }
  return grid;
}

/**
 * Rows pasted from a spreadsheet → the same `ParsedSheet` an `.xlsx` upload yields (first line = headers),
 * with the same empty / too-many-rows refusals, so paste and upload share every later step and rule.
 */
export function parsePastedRows(text: string, maxRows: number = MAX_IMPORT_ROWS): ParsedSheet {
  const grid = splitGrid(text).filter((r) => r.some((c) => c.trim() !== ''));
  const headers = (grid[0] ?? []).map((c) => c.trim());
  const rows = grid.slice(1).map((r) => headers.map((_, i) => (r[i] ?? '').trim()));
  if (headers.length === 0 || rows.length === 0) throw new ImportParseError('empty', 'The sheet has no data rows to import.');
  if (rows.length > maxRows) {
    throw new ImportParseError('too_many_rows', `Too many rows: ${rows.length}. Import at most ${maxRows} rows at a time.`);
  }
  return { headers, rows };
}
