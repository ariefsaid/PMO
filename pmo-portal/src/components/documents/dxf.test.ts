import { describe, expect, it } from 'vitest';
import { DXF_ENTITY_LIMIT, parseDxf } from './dxf';

/** A DXF file from group-code/value pairs, with an ENTITIES section around `entities`. */
const dxf = (entities: Array<string | number>[], extra: Array<string | number> = []) =>
  [...extra, 0, 'SECTION', 2, 'ENTITIES', ...entities.flat(), 0, 'ENDSEC', 0, 'EOF'].join('\r\n');

describe('#1588 parseDxf draws the ENTITIES section as one SVG path, y up', () => {
  it('a LINE is a move and a line, with y flipped for the screen', () => {
    expect(parseDxf(dxf([[0, 'LINE', 8, '0', 10, 1, 20, 2, 30, 0, 11, 4, 21, 6]]))).toEqual({
      path: 'M1 -2L4 -6', viewBox: expect.any(String), truncated: false,
    });
  });

  it('a closed LWPOLYLINE returns to its first vertex; an open one does not', () => {
    const closed = parseDxf(dxf([[0, 'LWPOLYLINE', 90, 3, 70, 1, 10, 0, 20, 0, 10, 2, 20, 0, 10, 2, 20, 2]]));
    expect(closed?.path).toBe('M0 0L2 0L2 -2Z');
    const open = parseDxf(dxf([[0, 'LWPOLYLINE', 90, 2, 70, 0, 10, 0, 20, 0, 10, 2, 20, 0]]));
    expect(open?.path).toBe('M0 0L2 0');
  });

  it('a POLYLINE takes its VERTEX entities until SEQEND', () => {
    const result = parseDxf(dxf([[0, 'POLYLINE', 66, 1, 70, 0], [0, 'VERTEX', 10, 0, 20, 0], [0, 'VERTEX', 10, 3, 20, 4], [0, 'SEQEND'], [0, 'LINE', 10, 9, 20, 9, 11, 9, 21, 8]]));
    expect(result?.path).toBe('M0 0L3 -4M9 -9L9 -8');
  });

  it('a CIRCLE is two half arcs and an ARC sweeps counter-clockwise from its start angle', () => {
    expect(parseDxf(dxf([[0, 'CIRCLE', 10, 0, 20, 0, 40, 2]]))?.path).toBe('M2 0A2 2 0 1 0 -2 0A2 2 0 1 0 2 0');
    // 0deg -> 90deg counter-clockwise: from (1,0) to (0,1), drawn clockwise once y is flipped.
    expect(parseDxf(dxf([[0, 'ARC', 10, 0, 20, 0, 40, 1, 50, 0, 51, 90]]))?.path).toBe('M1 0A1 1 0 0 0 0 -1');
    expect(parseDxf(dxf([[0, 'ARC', 10, 0, 20, 0, 40, 1, 50, 0, 51, 270]]))?.path).toBe('M1 0A1 1 0 1 0 0 1');
  });

  it('an ARC whose start and end angles are equal is a full circle', () => {
    const circle = parseDxf(dxf([[0, 'CIRCLE', 10, 0, 20, 0, 40, 2]]))?.path;
    expect(parseDxf(dxf([[0, 'ARC', 10, 0, 20, 0, 40, 2, 50, 30, 51, 30]]))?.path).toBe(circle);
    expect(parseDxf(dxf([[0, 'ARC', 10, 0, 20, 0, 40, 2, 50, 0, 51, 360]]))?.path).toBe(circle);
  });

  it('a blank line is not group code 0: a file with one where a code belongs is not DXF', () => {
    const blankCode = ['0', 'SECTION', '2', 'ENTITIES', '', 'LINE', '10', '0', '20', '0', '11', '1', '21', '1', '0', 'ENDSEC', '0', 'EOF'].join('\n');
    expect(parseDxf(blankCode)).toBeNull();
    // Trailing blank lines after the last pair end the file; they are not a broken code.
    const noEof = [0, 'SECTION', 2, 'ENTITIES', 0, 'LINE', 10, 0, 20, 0, 11, 1, 21, 0, 0, 'ENDSEC'].join('\n');
    expect(parseDxf(`${noEof}\n\n\n`)?.path).toBe('M0 0L1 0');
    // A blank VALUE line is ordinary DXF (an empty string value) and still parses.
    expect(parseDxf(dxf([[0, 'LINE', 1, '', 10, 0, 20, 0, 11, 1, 21, 0]]))?.path).toBe('M0 0L1 0');
  });

  it('the view box frames every entity with a margin', () => {
    const box = parseDxf(dxf([[0, 'LINE', 10, 0, 20, 0, 11, 100, 21, 50]]))!.viewBox.split(' ').map(Number);
    const [x, y, w, h] = box;
    expect(x).toBeLessThan(0);
    expect(y).toBeLessThan(-50);
    expect(x + w).toBeGreaterThan(100);
    expect(y + h).toBeGreaterThan(0);
  });

  it('entities outside the ENTITIES section (block definitions) are not drawn', () => {
    const blocks = [0, 'SECTION', 2, 'BLOCKS', 0, 'LINE', 10, 50, 20, 50, 11, 60, 21, 60, 0, 'ENDSEC'];
    expect(parseDxf(dxf([[0, 'LINE', 10, 0, 20, 0, 11, 1, 21, 1]], blocks))?.path).toBe('M0 0L1 -1');
  });

  it('unknown entities, broken numbers and a zero radius are skipped', () => {
    const result = parseDxf(dxf([[0, 'TEXT', 10, 5, 20, 5, 1, 'Label'], [0, 'LINE', 10, 'x', 20, 0, 11, 1, 21, 1], [0, 'CIRCLE', 10, 0, 20, 0, 40, 0], [0, 'LINE', 10, 0, 20, 0, 11, 1, 21, 0]]));
    expect(result?.path).toBe('M0 0L1 0');
  });

  it('nothing drawable, an empty file or a non-DXF text is null', () => {
    expect(parseDxf('')).toBeNull();
    expect(parseDxf('hello world')).toBeNull();
    expect(parseDxf(dxf([[0, 'TEXT', 10, 1, 20, 1, 1, 'x']]))).toBeNull();
  });

  it(`stops after ${DXF_ENTITY_LIMIT} entities and says the drawing is partial`, () => {
    const lines = Array.from({ length: DXF_ENTITY_LIMIT + 5 }, (_, n) => [0, 'LINE', 10, n, 20, 0, 11, n, 21, 1]);
    const result = parseDxf(dxf(lines))!;
    expect(result.truncated).toBe(true);
    expect(result.path.match(/M/g)).toHaveLength(DXF_ENTITY_LIMIT);
  });
});
