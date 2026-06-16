/**
 * C4 — Format edge-case unit tests.
 *
 * 1. formatCompactCurrency: values near the $1M boundary must not produce "$1000.0K".
 * 2. formatDocNumber: must use UTC date parts to stay TZ-stable.
 * 3. Gantt reversed-range: buildGanttModel clamps bar.width to 0 when end < start.
 */
import { describe, it, expect } from 'vitest';
import { formatCompactCurrency } from '../format';
import { formatDocNumber } from '../db/procurementLifecycle';
import { buildGanttModel } from '../gantt/ganttLayout';
import type { TaskWithRefs } from '../db/tasks';

// ── 1. formatCompactCurrency $1M boundary ────────────────────────────────────
// The "$1000.0K" bug: values like 999_950 divide by 1000 → 999.95 → .toFixed(1) = "1000.0".
// The fix rolls such values to the M tier instead.

describe('C4: formatCompactCurrency — $1M boundary (no "$1000.0K")', () => {
  it('999_950 (divides to 999.95, .toFixed(1)="1000.0") rolls to $1.0M', () => {
    expect(formatCompactCurrency(999_950)).toBe('$1.0M');
  });

  it('1_000_000 is $1.0M', () => {
    expect(formatCompactCurrency(1_000_000)).toBe('$1.0M');
  });

  it('999_900 (999.9K, does not round to 1000.0) stays in K tier', () => {
    expect(formatCompactCurrency(999_900)).toBe('$999.9K');
  });

  it('999_400 stays in K tier (999.4K)', () => {
    expect(formatCompactCurrency(999_400)).toBe('$999.4K');
  });

  it('negative boundary: -999_950 rolls to -$1.0M', () => {
    expect(formatCompactCurrency(-999_950)).toBe('-$1.0M');
  });
});

// ── 2. formatDocNumber TZ-stable (UTC) ───────────────────────────────────────

describe('C4: formatDocNumber — UTC date parts (TZ-stable)', () => {
  it('AC-803: 2026-06-04 UTC → PO-2606040001 (same result regardless of local TZ)', () => {
    // new Date('2026-06-04') parses as UTC midnight; getUTCDate() must be 4
    const date = new Date('2026-06-04T00:00:00Z');
    expect(formatDocNumber('PO', date, 1)).toBe('PO-2606040001');
  });

  it('UTC midnight on the 4th must not shift to the 3rd in behind-UTC timezones', () => {
    // Simulate a date at UTC midnight: getUTCDate()=4, but getDate() might be 3 in UTC-X.
    // We construct the date explicitly at UTC midnight and assert the UTC day is used.
    const date = new Date('2026-06-04T00:00:00Z');
    const result = formatDocNumber('PO', date, 1);
    // Must contain "26" + "06" + "04" — not "03" (what local TZ would give in UTC-1..UTC-12)
    expect(result).toBe('PO-2606040001');
  });

  it('seq 42 → PO-2606040042', () => {
    const date = new Date('2026-06-04T00:00:00Z');
    expect(formatDocNumber('PO', date, 42)).toBe('PO-2606040042');
  });
});

// ── 3. Gantt reversed-range clamps to 0 ─────────────────────────────────────

function makeTask(overrides: Partial<TaskWithRefs> & { id: string; name: string }): TaskWithRefs {
  return {
    org_id: 'org-1',
    project_id: 'p1',
    status: 'To Do',
    assignee_id: null,
    milestone_id: null,
    created_at: '2026-01-01T00:00:00Z',
    completed_at: null,
    assignee: null,
    dependencies: [],
    start_date: null,
    end_date: null,
    ...overrides,
  };
}

describe('C4: Gantt reversed-range bar.width is clamped to 0', () => {
  it('end before start → bar.width = 0 (not negative)', () => {
    const task = makeTask({
      id: 't1',
      name: 'Reversed',
      start_date: '2026-06-10',
      end_date: '2026-06-05', // end < start
    });

    const model = buildGanttModel([task], [], '2026-06-08');
    const lane = model.lanes.find((l) =>
      l.bars.some((b) => b.id === 't1'),
    );
    const bar = lane?.bars.find((b) => b.id === 't1');

    expect(bar).toBeDefined();
    expect(bar!.width).toBe(0);
  });

  it('normal bar (start < end) has positive width', () => {
    const task = makeTask({
      id: 't2',
      name: 'Normal',
      start_date: '2026-06-01',
      end_date: '2026-06-10',
    });

    const model = buildGanttModel([task], [], '2026-06-05');
    const lane = model.lanes.find((l) =>
      l.bars.some((b) => b.id === 't2'),
    );
    const bar = lane?.bars.find((b) => b.id === 't2');

    expect(bar).toBeDefined();
    expect(bar!.width).toBeGreaterThan(0);
  });
});
