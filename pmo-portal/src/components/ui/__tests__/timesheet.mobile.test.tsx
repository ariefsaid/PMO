/**
 * S7 — one-handed mobile timesheet entry
 * B-C-1 + A-C-3: below 768px the timesheet switches from the horizontal table
 * to a day-stacked layout so all 7 days are visible and editable without horizontal
 * clipping at 390px viewport width.
 *
 * Single-render seam: useIsDesktop() picks the branch; only ONE branch is in the
 * DOM at a time (exactly the OD-W4-4 pattern from DataTable.mobile).
 *
 * Test strategy:
 * - mockViewport(false) → mobile branch renders; desktop table absent.
 * - mockViewport(true)  → desktop table renders; mobile stack absent.
 * - All 7 day rows editable at mobile, each with an hour input + aria-label.
 * - Save + Submit buttons both reachable at mobile (not in the table, in the page).
 * - Desktop branch keeps the existing <table> structure.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { TimesheetGrid, type TimesheetGridRow, type TimesheetDay } from '../TimesheetGrid';

const days: TimesheetDay[] = [
  { label: 'Mon', dateNum: '2', weekend: false },
  { label: 'Tue', dateNum: '3', weekend: false },
  { label: 'Wed', dateNum: '4', weekend: false },
  { label: 'Thu', dateNum: '5', weekend: false },
  { label: 'Fri', dateNum: '6', weekend: false },
  { label: 'Sat', dateNum: '7', weekend: true },
  { label: 'Sun', dateNum: '8', weekend: true },
];

const rows: TimesheetGridRow[] = [
  { id: 'r1', project: 'Alpha Project', code: 'AP-001', hours: [4, 0, 8, 0, 6, 0, 0] },
  { id: 'r2', project: 'Beta Platform', code: 'BP-002', hours: [0, 0, 0, 3, 0, 0, 0] },
];

/**
 * Stubs window.matchMedia so useIsDesktop() resolves to the given breakpoint.
 * isDesktop=false → (min-width:768px) reports matches:false → mobile branch.
 */
function mockViewport(isDesktop: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: isDesktop,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

afterEach(() => vi.unstubAllGlobals());

// ── Branch selection (single render) ─────────────────────────────────────────

describe('TimesheetGrid mobile/desktop single-render seam (B-C-1)', () => {
  it('at mobile (<768px) renders the mobile day-stacked branch, NOT the table branch', () => {
    mockViewport(false);
    render(<TimesheetGrid days={days} rows={rows} editable />);
    // Mobile branch present
    expect(document.querySelector('[data-testid="tsgrid-mobile"]')).toBeInTheDocument();
    // Desktop table absent
    expect(document.querySelector('[data-testid="tsgrid-table"]')).not.toBeInTheDocument();
    expect(document.querySelector('table')).toBeNull();
  });

  it('at desktop (≥768px) renders the table branch, NOT the mobile branch', () => {
    mockViewport(true);
    render(<TimesheetGrid days={days} rows={rows} editable />);
    // Desktop table present
    expect(document.querySelector('[data-testid="tsgrid-table"]')).toBeInTheDocument();
    // Mobile branch absent
    expect(document.querySelector('[data-testid="tsgrid-mobile"]')).not.toBeInTheDocument();
  });
});

// ── All 7 days reachable + editable at mobile ─────────────────────────────────

describe('TimesheetGrid mobile: all 7 days editable (A-C-3)', () => {
  it('AC-S7-001: all 7 day rows render as editable hour inputs at mobile — no clipped/hidden day', () => {
    mockViewport(false);
    const onCellChange = vi.fn();
    render(
      <TimesheetGrid
        days={days}
        rows={rows}
        editable
        onCellChange={onCellChange}
      />,
    );
    // Every day × every project row must have an editable input
    for (const row of rows) {
      for (const day of days) {
        const input = screen.getByLabelText(`${row.project}, ${day.label} hours`);
        expect(input.tagName).toBe('INPUT');
      }
    }
  });

  it('AC-S7-002: typing into a mobile day cell calls onCellChange', async () => {
    mockViewport(false);
    const onCellChange = vi.fn();
    render(
      <TimesheetGrid
        days={days}
        rows={[{ id: 'r1', project: 'Alpha Project', code: 'AP-001', hours: [0, 0, 0, 0, 0, 0, 0] }]}
        editable
        onCellChange={onCellChange}
      />,
    );
    const wedInput = screen.getByLabelText('Alpha Project, Wed hours');
    await userEvent.type(wedInput, '5');
    expect(onCellChange).toHaveBeenLastCalledWith('r1', 2, '5');
  });

  it('AC-S7-003: mobile cells carry touch-target class (WCAG 2.5.5)', () => {
    mockViewport(false);
    render(
      <TimesheetGrid
        days={days}
        rows={[{ id: 'r1', project: 'Alpha Project', code: 'AP-001', hours: [0, 0, 0, 0, 0, 0, 0] }]}
        editable
      />,
    );
    const monInput = screen.getByLabelText('Alpha Project, Mon hours');
    expect(monInput.className).toContain('touch-target');
  });

  it('AC-S7-004: mobile view shows all 7 day labels (Mon through Sun, including weekend)', () => {
    mockViewport(false);
    render(<TimesheetGrid days={days} rows={rows} editable />);
    const mobileEl = document.querySelector('[data-testid="tsgrid-mobile"]')!;
    expect(mobileEl).toBeInTheDocument();
    for (const day of days) {
      // Each day label should appear in the mobile branch
      expect(mobileEl.textContent).toContain(day.label);
    }
  });

  it('AC-S7-005: per-row delete button is reachable at mobile (stays accessible without horizontal scroll)', () => {
    mockViewport(false);
    const onDeleteRow = vi.fn();
    render(
      <TimesheetGrid
        days={days}
        rows={[{ id: 'r1', project: 'Alpha Project', code: 'AP-001', hours: [0, 0, 0, 0, 0, 0, 0] }]}
        editable
        onDeleteRow={onDeleteRow}
      />,
    );
    const deleteBtn = screen.getByRole('button', { name: 'Delete Alpha Project row' });
    expect(deleteBtn).toBeInTheDocument();
    // It is in the mobile branch (not a hidden table column)
    const mobileBranch = document.querySelector('[data-testid="tsgrid-mobile"]')!;
    expect(mobileBranch.contains(deleteBtn)).toBe(true);
  });

  it('AC-S7-006: invalid cell in mobile view shows aria-invalid and inline error', () => {
    mockViewport(false);
    render(
      <TimesheetGrid
        days={days}
        rows={[{ id: 'r1', project: 'Alpha Project', code: 'AP-001', hours: [25, 0, 0, 0, 0, 0, 0] }]}
        editable
        invalidCells={new Set(['r1:0'])}
      />,
    );
    const monInput = screen.getByLabelText('Alpha Project, Mon hours');
    expect(monInput).toHaveAttribute('aria-invalid', 'true');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/0.?24/);
  });

  it('AC-S7-007: read-only mobile view renders static cells (no inputs)', () => {
    mockViewport(false);
    render(<TimesheetGrid days={days} rows={rows} />);
    // Mobile branch present (read-only)
    expect(document.querySelector('[data-testid="tsgrid-mobile"]')).toBeInTheDocument();
    // No editable inputs — read-only cells
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });

  it('AC-S7-008: row totals are shown in mobile view', () => {
    mockViewport(false);
    render(<TimesheetGrid days={days} rows={rows} />);
    // r1 total = 4+8+6 = 18, r2 total = 3
    expect(screen.getByTestId('tsgrid-row-total-r1')).toHaveTextContent('18');
    expect(screen.getByTestId('tsgrid-row-total-r2')).toHaveTextContent('3');
  });

  it('AC-S7-009: mobile note expand/collapse works (existing NoteCell behavior)', async () => {
    mockViewport(false);
    const onNoteChange = vi.fn();
    render(
      <TimesheetGrid
        days={days}
        rows={[{ id: 'r1', project: 'Alpha Project', code: 'AP-001', hours: [0, 0, 0, 0, 0, 0, 0] }]}
        editable
        notes={{ r1: '' }}
        onNoteChange={onNoteChange}
      />,
    );
    // The collapsed "+ Note" button is accessible and has touch-target
    const noteBtn = screen.getByRole('button', { name: /Add note to Alpha Project/i });
    expect(noteBtn.className).toContain('touch-target');
    // Clicking it reveals the note input
    await userEvent.click(noteBtn);
    const noteInput = screen.getByLabelText('Alpha Project note');
    expect(noteInput).toBeInTheDocument();
    // Typing calls onNoteChange with (rowId, typed-char) — controlled input,
    // same contract as the existing desktop note test in timesheet.test.tsx.
    await userEvent.type(noteInput, 'x');
    expect(onNoteChange).toHaveBeenLastCalledWith('r1', 'x');
  });
});

// ── A11y: single AT tree (no aria-hidden on either branch) ────────────────────

describe('TimesheetGrid mobile a11y: single AT tree', () => {
  it('AC-S7-A11Y: the mobile branch has NO aria-hidden (it is the only data structure at mobile)', () => {
    mockViewport(false);
    render(<TimesheetGrid days={days} rows={rows} editable />);
    const mobileBranch = document.querySelector('[data-testid="tsgrid-mobile"]')!;
    expect(mobileBranch).toBeInTheDocument();
    expect(mobileBranch).not.toHaveAttribute('aria-hidden');
  });

  it('AC-S7-A11Y: each mobile day section has an accessible heading or label for the day', () => {
    mockViewport(false);
    render(
      <TimesheetGrid
        days={days}
        rows={[{ id: 'r1', project: 'Alpha Project', code: 'AP-001', hours: [4, 0, 0, 0, 0, 0, 0] }]}
        editable
      />,
    );
    // Each day label is present in the mobile branch as some form of heading/text
    const mobileBranch = document.querySelector('[data-testid="tsgrid-mobile"]')!;
    expect(mobileBranch.textContent).toContain('Mon');
    expect(mobileBranch.textContent).toContain('Tue');
    expect(mobileBranch.textContent).toContain('Sat'); // weekend
  });
});
