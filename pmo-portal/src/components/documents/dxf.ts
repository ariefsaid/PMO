// dxf.ts — a bounded, dependency-free reading of an ASCII DXF drawing (#1588). It draws the geometry of the
// ENTITIES section (LINE, LWPOLYLINE, POLYLINE/VERTEX, CIRCLE, ARC) as ONE SVG path, y flipped so the drawing
// is upright on screen. Text, hatches, dimensions and block inserts are not drawn: this is a quick look at the
// shape of a drawing, and Download stays the way to see all of it. Polyline bulges are drawn as straight segments.

export interface Drawing {
  /** SVG path data in screen coordinates (DXF y negated). */
  path: string;
  viewBox: string;
  /** True when the entity limit stopped the reading before the end of the drawing. */
  truncated: boolean;
}

/** The most entities drawn from one file, so a huge drawing cannot stall the panel. */
export const DXF_ENTITY_LIMIT = 20_000;

interface Entity {
  type: string;
  pairs: Array<[number, string]>;
}

/** The entities of the ENTITIES section, as group-code/value pairs; null when the text is not DXF. */
function readEntities(text: string): Entity[] | null {
  const lines = text.split(/\r\n|\r|\n/u);
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  const entities: Entity[] = [];
  let section: string | null = null;
  let awaitingName = false;
  let current: Entity | null = null;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    // A group code is digits only: a blank line is not code 0 (Number('') would be).
    const raw = lines[i]!.trim();
    if (!/^-?\d+$/u.test(raw)) return null;
    const code = Number(raw);
    const value = lines[i + 1]!.trim();
    if (code === 0) {
      current = null;
      if (value === 'SECTION') awaitingName = true;
      else if (value === 'ENDSEC') section = null;
      else if (value === 'EOF') break;
      else if (section === 'ENTITIES') {
        current = { type: value, pairs: [] };
        entities.push(current);
      }
    } else if (awaitingName && code === 2) {
      section = value;
      awaitingName = false;
    } else if (current) {
      current.pairs.push([code, value]);
    }
  }
  return entities;
}

const num = (entity: Entity, code: number): number => {
  const pair = entity.pairs.find(([c]) => c === code);
  return pair ? Number(pair[1]) : Number.NaN;
};
/** Rounded to 3 decimals, with no negative zero, so the path stays short and stable. */
const fmt = (n: number): string => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

/** The vertices of a LWPOLYLINE (10/20 pairs in order) or of a run of VERTEX entities. */
function vertices(pairs: Array<[number, string]>): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (const [code, value] of pairs) {
    if (code === 10) points.push([Number(value), Number.NaN]);
    else if (code === 20 && points.length > 0) points[points.length - 1]![1] = Number(value);
  }
  return points;
}

export function parseDxf(text: string): Drawing | null {
  const entities = readEntities(text);
  if (!entities) return null;
  const parts: string[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const extend = (x: number, y: number) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  };
  const point = (x: number, y: number) => {
    extend(x, -y);
    return `${fmt(x)} ${fmt(-y)}`;
  };
  const finite = (...values: number[]) => values.every(Number.isFinite);
  const polyline = (points: Array<[number, number]>, closed: boolean) => {
    if (points.length < 2 || !points.every(([x, y]) => finite(x, y))) return false;
    parts.push(`M${points.map(([x, y]) => point(x, y)).join('L')}${closed ? 'Z' : ''}`);
    return true;
  };

  let drawn = 0;
  let truncated = false;
  for (let i = 0; i < entities.length; i += 1) {
    if (drawn >= DXF_ENTITY_LIMIT) { truncated = true; break; }
    const entity = entities[i]!;
    let ok = false;
    if (entity.type === 'LINE') {
      const [x1, y1, x2, y2] = [num(entity, 10), num(entity, 20), num(entity, 11), num(entity, 21)];
      if (finite(x1, y1, x2, y2)) { parts.push(`M${point(x1, y1)}L${point(x2, y2)}`); ok = true; }
    } else if (entity.type === 'LWPOLYLINE') {
      ok = polyline(vertices(entity.pairs), (num(entity, 70) & 1) === 1);
    } else if (entity.type === 'POLYLINE') {
      const run: Array<[number, string]> = [];
      while (entities[i + 1]?.type === 'VERTEX') {
        i += 1;
        const v = entities[i]!;
        run.push([10, String(num(v, 10))], [20, String(num(v, 20))]);
      }
      if (entities[i + 1]?.type === 'SEQEND') i += 1;
      ok = polyline(vertices(run), (num(entity, 70) & 1) === 1);
    } else if (entity.type === 'CIRCLE' || entity.type === 'ARC') {
      const [cx, cy, r] = [num(entity, 10), num(entity, 20), num(entity, 40)];
      if (finite(cx, cy, r) && r > 0) {
        extend(cx - r, -cy - r);
        extend(cx + r, -cy + r);
        const at = (deg: number) => `${fmt(cx + r * Math.cos((deg * Math.PI) / 180))} ${fmt(-(cy + r * Math.sin((deg * Math.PI) / 180)))}`;
        const radius = `${fmt(r)} ${fmt(r)}`;
        const [start, end] = [num(entity, 50), num(entity, 51)];
        // DXF: an ARC whose start and end angles coincide (mod 360) is a full circle.
        const full = entity.type === 'CIRCLE' || (finite(start, end) && (((end - start) % 360) + 360) % 360 === 0);
        if (full) {
          parts.push(`M${at(0)}A${radius} 0 1 0 ${at(180)}A${radius} 0 1 0 ${at(0)}`);
          ok = true;
        } else {
          if (finite(start, end)) {
            const sweep = (((end - start) % 360) + 360) % 360;
            // DXF arcs run counter-clockwise; with y flipped that is SVG's clockwise (sweep-flag 0).
            parts.push(`M${at(start)}A${radius} 0 ${sweep > 180 ? 1 : 0} 0 ${at(end)}`);
            ok = true;
          }
        }
      }
    }
    if (ok) drawn += 1;
  }
  if (parts.length === 0) return null;
  const width = maxX - minX;
  const height = maxY - minY;
  const margin = Math.max(width, height) * 0.02 || 1;
  const viewBox = [minX - margin, minY - margin, width + 2 * margin, height + 2 * margin].map(fmt).join(' ');
  return { path: parts.join(''), viewBox, truncated };
}
