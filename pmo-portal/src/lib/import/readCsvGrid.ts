import { ImportParseError } from './types';
import type { WorkbookCell, WorkbookGrid } from './readWorkbookGrid';

const invalid = (): ImportParseError =>
  new ImportParseError('invalidCsv', 'CSV quoting or columns are invalid.');
const makeCell = (value: string): WorkbookCell => ({
  text: value.trim(),
  value: value.trim(),
  formula: false,
});

/** Strict CSV decoder for FX files. No best-effort splitting or formula evaluation. */
export function readCsvGrid(text: string): WorkbookGrid {
  const source = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const rows: WorkbookCell[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;

  const finishField = () => {
    row.push(field);
    field = '';
    closedQuote = false;
  };
  const finishRow = () => {
    finishField();
    rows.push(row.map(makeCell));
    row = [];
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else field += char;
      continue;
    }
    if (closedQuote) {
      if (char === ',') finishField();
      else if (char === '\n' || char === '\r') {
        finishRow();
        if (char === '\r' && source[i + 1] === '\n') i += 1;
      } else throw invalid();
      continue;
    }
    if (char === '"') {
      if (field !== '') throw invalid();
      quoted = true;
    } else if (char === ',') finishField();
    else if (char === '\n' || char === '\r') {
      finishRow();
      if (char === '\r' && source[i + 1] === '\n') i += 1;
    } else field += char;
  }
  if (quoted) throw invalid();
  if (field !== '' || row.length > 0 || closedQuote) finishRow();

  const nonblank = rows.filter((cells) => cells.some((cell) => cell.text !== ''));
  if (nonblank.length > 1) {
    const expected = nonblank[0].length;
    if (nonblank.some((cells) => cells.length !== expected)) throw invalid();
  }
  return { rows, date1904: false };
}
