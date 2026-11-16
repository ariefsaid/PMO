import { describe, it, expect } from 'vitest';
import { parsePastedRows } from '../parsePaste';
import { MAX_IMPORT_ROWS } from '../types';

describe('parsePastedRows (#1278)', () => {
  it('reads tab-separated rows with the first line as headers, ignoring blank lines and CRLF', () => {
    expect(parsePastedRows('A\tB\r\n1\t2\r\n\r\n3\t4\r\n')).toEqual({ headers: ['A', 'B'], rows: [['1', '2'], ['3', '4']] });
  });
  it('keeps a quoted cell with a tab, a newline and a doubled quote whole', () => {
    expect(parsePastedRows('A\tB\n"x\ty\nz ""q"""\t2')).toEqual({ headers: ['A', 'B'], rows: [['x\ty\nz "q"', '2']] });
  });
  it('pads a short row and refuses header-only and oversized pastes like the upload', () => {
    expect(parsePastedRows('A\tB\n1').rows).toEqual([['1', '']]);
    expect(() => parsePastedRows('A\tB')).toThrow(/no data rows/);
    expect(() => parsePastedRows('A\n' + '1\n'.repeat(MAX_IMPORT_ROWS + 1))).toThrow(/Too many rows/);
  });
});
