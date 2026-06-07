import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { TimesheetGrid, type TimesheetGridRow, type TimesheetDay } from '../TimesheetGrid';
import { ErrBanner } from '../ErrBanner';
import { ApprovalRow } from '../ApprovalRow';

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
  { id: 'r1', project: 'Eastfield Logistics Park', code: 'PRJ-0142', hours: [8, 8, 7.5, 8, 6, 0, 0] },
  { id: 'r2', project: 'Greystone Hospital MEP', code: 'PRJ-0138', hours: [0, 0, 0.5, 0, 2, 0, 0] },
];

describe('TimesheetGrid', () => {
  it('renders a project row per row with name + mono code', () => {
    render(<TimesheetGrid days={days} rows={rows} />);
    expect(screen.getByText('Eastfield Logistics Park')).toBeInTheDocument();
    expect(screen.getByText('PRJ-0142')).toBeInTheDocument();
  });

  it('renders per-cell aria-labels "{project}, {day} hours" so cells are screen-reader addressable', () => {
    render(<TimesheetGrid days={days} rows={rows} />);
    // r1 Mon = 8 hours
    const cell = screen.getByLabelText('Eastfield Logistics Park, Mon hours');
    expect(cell).toHaveTextContent('8');
  });

  it('shows a row total and a per-day daily total and the weekly grand total', () => {
    render(<TimesheetGrid days={days} rows={rows} />);
    // r1 total = 37.5, r2 total = 2.5 → weekly grand = 40
    expect(screen.getByTestId('tsgrid-row-total-r1')).toHaveTextContent('37.5');
    expect(screen.getByTestId('tsgrid-daily-total-0')).toHaveTextContent('8'); // Mon: 8 + 0
    expect(screen.getByTestId('tsgrid-grand-total')).toHaveTextContent('40');
  });

  it('marks weekend day headers and cells with a weekend class (visual distinction)', () => {
    render(<TimesheetGrid days={days} rows={rows} />);
    // Sat header cell is weekend
    const satHeader = screen.getByText('Sat').closest('th')!;
    expect(satHeader.className).toContain('weekend');
  });

  it('empty cells render a centred dot placeholder, filled cells render the number', () => {
    render(<TimesheetGrid days={days} rows={rows} />);
    // r2 Mon = 0 → placeholder, not "0"
    const empty = screen.getByLabelText('Greystone Hospital MEP, Mon hours');
    expect(empty).toHaveTextContent('·');
    const filled = screen.getByLabelText('Greystone Hospital MEP, Fri hours');
    expect(filled).toHaveTextContent('2');
  });

  it('exposes the grid as a table with column headers', () => {
    render(<TimesheetGrid days={days} rows={rows} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Project' })).toBeInTheDocument();
  });
});

describe('TimesheetGrid (editable mode)', () => {
  it('AC-TSE-001: editable grid renders hour inputs + per-row delete when editable', () => {
    const editRows: TimesheetGridRow[] = [
      { id: 'p1', project: 'Acme Platform', code: 'P003', hours: [8, 0, 0, 0, 0, 0, 0] },
    ];
    render(<TimesheetGrid days={days} rows={editRows} editable />);
    // 7 editable hour cells → 7 labelled text inputs (inputMode=decimal preserves "7.").
    const inputs = days.map((d) => screen.getByLabelText(`Acme Platform, ${d.label} hours`));
    expect(inputs.length).toBe(7);
    inputs.forEach((el) => expect(el.tagName).toBe('INPUT'));
    // Per-row delete control with an accessible name.
    expect(
      screen.getByRole('button', { name: 'Delete Acme Platform row' }),
    ).toBeInTheDocument();
  });

  it('the read-only branch (editable false) keeps the shipped read-only cells unchanged', () => {
    render(<TimesheetGrid days={days} rows={rows} />);
    // Read-only path renders the dot placeholder + no editable inputs at all.
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    const empty = screen.getByLabelText('Greystone Hospital MEP, Mon hours');
    expect(empty).toHaveTextContent('·');
    expect(empty.tagName).toBe('DIV');
  });

  it('AC-TSE-007: typing into a cell calls onCellChange and does not write', async () => {
    const onCellChange = vi.fn();
    const editRows: TimesheetGridRow[] = [
      { id: 'p1', project: 'Acme Platform', code: 'P003', hours: [0, 0, 0, 0, 0, 0, 0] },
    ];
    render(<TimesheetGrid days={days} rows={editRows} editable onCellChange={onCellChange} />);
    const tue = screen.getByLabelText('Acme Platform, Tue hours');
    await userEvent.type(tue, '8');
    // The last call carries (rowId, dayIndex=1, raw='8') — no DAL/mutation exists in the grid.
    expect(onCellChange).toHaveBeenLastCalledWith('p1', 1, '8');
  });

  it('AC-TSE-008: editing the row note calls onNoteChange', async () => {
    const onNoteChange = vi.fn();
    const editRows: TimesheetGridRow[] = [
      { id: 'p1', project: 'Acme Platform', code: 'P003', hours: [0, 0, 0, 0, 0, 0, 0] },
    ];
    render(
      <TimesheetGrid
        days={days}
        rows={editRows}
        editable
        notes={{ p1: '' }}
        onNoteChange={onNoteChange}
      />,
    );
    const note = screen.getByLabelText('Acme Platform note');
    await userEvent.type(note, 'x');
    expect(onNoteChange).toHaveBeenLastCalledWith('p1', 'x');
  });

  it('AC-TSE-009/010: an invalid cell shows an inline error and marks aria-invalid', () => {
    const editRows: TimesheetGridRow[] = [
      { id: 'p1', project: 'Acme Platform', code: 'P003', hours: [25, 0, 0, 0, 0, 0, 0] },
    ];
    render(
      <TimesheetGrid
        days={days}
        rows={editRows}
        editable
        invalidCells={new Set(['p1:0'])}
      />,
    );
    const mon = screen.getByLabelText('Acme Platform, Mon hours');
    expect(mon).toHaveAttribute('aria-invalid', 'true');
    // An inline alert near the cell (not color-only).
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/0.?24/);
    // A valid cell is not marked invalid.
    const tue = screen.getByLabelText('Acme Platform, Tue hours');
    expect(tue).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('AC-TSE-012: editable grid totals reflect edited cell values live', () => {
    const editRows: TimesheetGridRow[] = [
      // hours as numbers; the page passes parsed numbers for display, edit strings via value
      { id: 'p1', project: 'Acme Platform', code: 'P003', hours: [6, 4, 0, 0, 0, 0, 0] },
    ];
    render(<TimesheetGrid days={days} rows={editRows} editable />);
    expect(screen.getByTestId('tsgrid-row-total-p1')).toHaveTextContent('10');
    expect(screen.getByTestId('tsgrid-daily-total-0')).toHaveTextContent('6');
    expect(screen.getByTestId('tsgrid-daily-total-1')).toHaveTextContent('4');
    expect(screen.getByTestId('tsgrid-grand-total')).toHaveTextContent('10');
  });

  it('AC-TSE-013: activating row delete calls onDeleteRow with the row id', async () => {
    const onDeleteRow = vi.fn();
    const editRows: TimesheetGridRow[] = [
      { id: 'p1', project: 'Acme Platform', code: 'P003', hours: [0, 0, 0, 0, 0, 0, 0] },
    ];
    render(<TimesheetGrid days={days} rows={editRows} editable onDeleteRow={onDeleteRow} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete Acme Platform row' }));
    expect(onDeleteRow).toHaveBeenCalledWith('p1');
  });

  it('editable cells reflect the raw edit string (preserves in-progress values like "7." and a typed "0")', () => {
    const editRows: TimesheetGridRow[] = [
      { id: 'p1', project: 'Acme Platform', code: 'P003', hours: [7.5, 0, 0, 0, 0, 0, 0] },
    ];
    render(
      <TimesheetGrid
        days={days}
        rows={editRows}
        editable
        // raw strings as the user typed them — the input must show these verbatim
        rawHours={{ p1: ['7.', '0', '', '', '', '', ''] }}
      />,
    );
    expect((screen.getByLabelText('Acme Platform, Mon hours') as HTMLInputElement).value).toBe('7.');
    // A typed "0" stays "0", not blanked.
    expect((screen.getByLabelText('Acme Platform, Tue hours') as HTMLInputElement).value).toBe('0');
  });

  it('NFR-TSE-A11Y-001: every editable cell has aria-label "<project>, <weekday> hours"', () => {
    const editRows: TimesheetGridRow[] = [
      { id: 'p1', project: 'Acme Platform', code: 'P003', hours: [0, 0, 0, 0, 0, 0, 0] },
    ];
    render(<TimesheetGrid days={days} rows={editRows} editable />);
    for (const d of days) {
      const cell = screen.getByLabelText(`Acme Platform, ${d.label} hours`);
      expect(cell.tagName).toBe('INPUT');
    }
  });
});

describe('ErrBanner', () => {
  it('renders as role=status (an expected returned-week state, not an alert failure)', () => {
    render(<ErrBanner title="Returned for changes" sub="Fix Fri and resubmit." />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Returned for changes')).toBeInTheDocument();
    expect(screen.getByText('Fix Fri and resubmit.')).toBeInTheDocument();
  });

  it('renders an optional action button that calls its handler', async () => {
    const onAction = vi.fn();
    render(
      <ErrBanner title="Returned" action={{ label: 'Review', onClick: onAction }} />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(onAction).toHaveBeenCalledOnce();
  });
});

describe('ApprovalRow', () => {
  it('renders the owner name, week, hours and a status pill', () => {
    render(
      <ApprovalRow
        name="Dave Engineer"
        week="Week of Jun 2"
        hours={38.5}
        status={<span>Submitted</span>}
      />
    );
    expect(screen.getByText('Dave Engineer')).toBeInTheDocument();
    expect(screen.getByText(/Jun 2/)).toBeInTheDocument();
    expect(screen.getByText(/38\.5/)).toBeInTheDocument();
    expect(screen.getByText('Submitted')).toBeInTheDocument();
  });

  it('renders an avatar with the owner initial (decorative, aria-hidden)', () => {
    const { container } = render(<ApprovalRow name="Priya Venkatesh" week="Week" hours={40} />);
    const avatar = container.querySelector('[aria-hidden="true"]');
    expect(avatar).toHaveTextContent('P');
  });

  it('renders action buttons passed as children', () => {
    render(
      <ApprovalRow name="Tobias" week="Week" hours={42}>
        <button>Approve</button>
        <button>Return</button>
      </ApprovalRow>
    );
    const row = screen.getByText('Tobias').closest('[data-approval-row]')!;
    expect(within(row as HTMLElement).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(within(row as HTMLElement).getByRole('button', { name: 'Return' })).toBeInTheDocument();
  });
});
