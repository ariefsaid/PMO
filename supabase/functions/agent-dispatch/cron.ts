/**
 * cron.ts — a minimal standard 5-field cron expression matcher (min hour dom month dow), used by
 * the agent-dispatch edge fn's schedule selection (FR-AAN-011, AC-AAN-021). Supports `*`, single
 * values, comma lists, `*​/n` steps, and `a-b` ranges — enough for the schedules `create_automation`
 * produces. No external dependency (a mechanical implementation choice, spec Open Q).
 *
 * All matching is UTC: the schedule string is stored and matched in UTC; TZ-aware schedules are out
 * of scope for v1 (ADR-0044 §2 does not require them).
 */

type Field = { min: number; max: number };

const FIELDS: Field[] = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 6 },  // day of week (0 = Sunday)
];

function parseField(raw: string, field: Field): Set<number> {
  const values = new Set<number>();
  for (const part of raw.split(',')) {
    const stepMatch = part.match(/^(\*|\d+(?:-\d+)?)\/(\d+)$/);
    if (stepMatch) {
      const [, range, stepStr] = stepMatch;
      const step = Number(stepStr);
      const [start, end] = range === '*' ? [field.min, field.max] : rangeBounds(range);
      for (let v = start; v <= end; v += step) values.add(v);
      continue;
    }
    if (part === '*') {
      for (let v = field.min; v <= field.max; v++) values.add(v);
      continue;
    }
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const [start, end] = rangeBounds(part);
      for (let v = start; v <= end; v++) values.add(v);
      continue;
    }
    const single = Number(part);
    if (!Number.isNaN(single)) values.add(single);
  }
  return values;
}

function rangeBounds(range: string): [number, number] {
  const [start, end] = range.split('-').map(Number);
  return [start, end];
}

/**
 * cronMatches — true when `at` (compared in UTC) matches the standard 5-field cron expression
 * `expr`. Returns false for a malformed/unparseable expression (fail-closed: an unmatchable
 * schedule never fires).
 */
export function cronMatches(expr: string, at: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minSet, hourSet, domSet, monthSet, dowSet] = parts.map((part, i) => parseField(part, FIELDS[i]));

  const minute = at.getUTCMinutes();
  const hour = at.getUTCHours();
  const dom = at.getUTCDate();
  const month = at.getUTCMonth() + 1;
  const dow = at.getUTCDay();

  return minSet.has(minute) && hourSet.has(hour) && domSet.has(dom) && monthSet.has(month) && dowSet.has(dow);
}
