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
