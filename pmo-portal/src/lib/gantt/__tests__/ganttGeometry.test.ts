/**
 * Unit tests for the pure SVG-path helpers in ganttGeometry.ts.
 * Owns: AC-GANTT-012 (the path-string half — edge resolution is in ganttLayout.test.ts).
 */
import { describe, it, expect } from 'vitest';
import {
  edgePath,
  arrowHead,
  SCALE_PX_PER_DAY,
  EDGE_GAP,
  EDGE_ARROW,
} from '../ganttGeometry';
import type { GanttEdge } from '../ganttLayout';

function makeEdge(overrides: Partial<GanttEdge>): GanttEdge {
  return {
    id: 'a->b',
    fromId: 'a',
    toId: 'b',
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 0,
    forward: true,
    ...overrides,
  };
}

describe('AC-GANTT-012: edge path strings (frappe-gantt elbow blueprint)', () => {
  it('AC-GANTT-012: forward edge path is an elbow from pred-end to succ-start ending near (x2,y2)', () => {
    const e = makeEdge({ x1: 60, y1: 20, x2: 120, y2: 60, forward: true });
    const d = edgePath(e);
    // Starts at the predecessor end.
    expect(d.startsWith('M60,20')).toBe(true);
    // Runs out a stub, drops to the successor row, and runs into the successor start.
    expect(d).toContain(`H${60 + EDGE_GAP}`); // H72
    expect(d).toContain('V60'); // drop to successor row
    expect(d).toContain(`H${120 - EDGE_ARROW}`); // H114 — stops short of the arrow inset
    // The path ends at the arrow inset just before (x2,y2).
    expect(d.trim().endsWith(`H${120 - EDGE_ARROW}`)).toBe(true);
  });

  it('AC-GANTT-012: backward edge wraps around (successor before predecessor)', () => {
    const e = makeEdge({ x1: 120, y1: 20, x2: 40, y2: 60, forward: false });
    const d = edgePath(e);
    expect(d.startsWith('M120,20')).toBe(true);
    // Out a stub past the predecessor end.
    expect(d).toContain(`H${120 + EDGE_GAP}`); // H132
    // Detour to the mid-Y between the two rows ((20+60)/2 = 40), then back to before x2.
    expect(d).toContain('V40');
    expect(d).toContain(`H${40 - EDGE_GAP}`); // H28
    // Finally drops to the successor row and runs into the start inset.
    expect(d).toContain('V60');
    expect(d).toContain(`H${40 - EDGE_ARROW}`); // H34
  });

  it('AC-GANTT-012: arrowHead is a 3-point polygon aimed at the successor start (x2,y2)', () => {
    const e = makeEdge({ x1: 60, y1: 20, x2: 120, y2: 60, forward: true });
    const pts = arrowHead(e);
    // The tip is at (x2, y2).
    expect(pts).toContain('120,60');
    // Three coordinate pairs (a triangle).
    expect(pts.trim().split(/\s+/)).toHaveLength(3);
  });

  it('AC-GANTT-012: scale + routing constants are stable', () => {
    expect(SCALE_PX_PER_DAY).toEqual({ day: 28, week: 16, month: 6, quarter: 2 });
    expect(EDGE_GAP).toBe(12);
    expect(EDGE_ARROW).toBe(6);
  });
});
