/**
 * C4 — Format edge-case unit tests.
 *
 * 1. formatCompactCurrency: values near the $1M boundary must not produce "$1000.0K".
 * 2. Gantt reversed-range: buildGanttModel clamps bar.width to 0 when end < start.
 * (formatDocNumber removed, #1710 — AC-803 lives at pgTAP,
 * supabase/tests/procurement_doc_number_format.test.sql.)
 */
import { describe, it, expect } from 'vitest';
import { formatCompactCurrency } from '../format';
import { buildGanttModel } from '../gantt/ganttLayout';
import type { TaskWithRefs } from '../db/tasks';

// ── 1. formatCompactCurrency $1M boundary ────────────────────────────────────
// The "$1000.0K" bug: values like 999_950 divide by 1000 → 999.95 → .toFixed(1) = "1000.0".
// The fix rolls such values to the M tier instead.

describe('C4: formatCompactCurrency — $1M boundary (no "$1000.0K")', () => {
  it('999_950 (divides to 999.95, .toFixed(1)="1000.0") rolls to $1.0M', () => {
    expect(formatCompactCurrency(999_950, 'USD')).toBe('$1.0M');
  });

  it('1_000_000 is $1.0M', () => {
    expect(formatCompactCurrency(1_000_000, 'USD')).toBe('$1.0M');
  });

  it('999_900 (999.9K, does not round to 1000.0) stays in K tier', () => {
    expect(formatCompactCurrency(999_900, 'USD')).toBe('$999.9K');
  });

  it('999_400 stays in K tier (999.4K)', () => {
    expect(formatCompactCurrency(999_400, 'USD')).toBe('$999.4K');
  });

  it('negative boundary: -999_950 rolls to -$1.0M', () => {
    expect(formatCompactCurrency(-999_950, 'USD')).toBe('-$1.0M');
  });

  it('FR-L10N-022 (AC-L10N-022): IDR compact has no welded $ — symbol follows the record currency', () => {
    expect(formatCompactCurrency(2500000, 'IDR')).toBe('IDR\u00A02.5M');
  });
});

// ── 2. (formatDocNumber removed, #1710 — AC-803 lives at pgTAP:
//       supabase/tests/procurement_doc_number_format.test.sql; the deleted TS mirror was the
//       second date authority behind the C4 TZ bug.) ──

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
    created_by: null,
    tombstoned_at: null,
    meeting_id: null,
    source_updated_at: null,
    description: null,
    priority: null,
    parent_task_id: null,
    archived_at: null,
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
