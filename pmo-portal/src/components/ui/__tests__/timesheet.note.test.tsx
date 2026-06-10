/**
 * AC-W6-IXD-NOTE — the per-row note is demoted. Primary treatment = collapse-on-demand:
 * an empty note shows a quiet labelled "+ Note" button ("Add note to <project>"); clicking
 * it reveals + focuses the input. Existing note content renders expanded on mount (never
 * hidden). Read-only branch has no note affordance. Typing fires onNoteChange.
 */
import { describe, it, expect, vi } from 'vitest';
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
  { id: 'r1', project: 'Eastfield Logistics Park', code: 'PRJ-0142', hours: [8, 8, 7.5, 8, 6, 0, 0] },
];

describe('TimesheetGrid — note demotion (AC-W6-IXD-NOTE)', () => {
  it('AC-W6-IXD-NOTE: an editable row with an EMPTY note renders an "Add note to <project>" button and NOT the input', () => {
    render(<TimesheetGrid days={days} rows={rows} editable notes={{}} onNoteChange={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: /Add note to Eastfield Logistics Park/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Eastfield Logistics Park note')).not.toBeInTheDocument();
  });

  it('AC-W6-IXD-NOTE: clicking "+ Note" reveals the input and moves focus to it', async () => {
    render(<TimesheetGrid days={days} rows={rows} editable notes={{}} onNoteChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Add note to Eastfield Logistics Park/i }));
    const input = screen.getByLabelText('Eastfield Logistics Park note');
    expect(input).toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it('AC-W6-IXD-NOTE: an editable row with EXISTING note content renders the input expanded on mount (content never hidden)', () => {
    render(
      <TimesheetGrid
        days={days}
        rows={rows}
        editable
        notes={{ r1: 'Overtime on Wed' }}
        onNoteChange={vi.fn()}
      />,
    );
    const input = screen.getByLabelText('Eastfield Logistics Park note') as HTMLInputElement;
    expect(input.value).toBe('Overtime on Wed');
    // No collapsed "+ Note" button when content already exists.
    expect(
      screen.queryByRole('button', { name: /Add note to Eastfield Logistics Park/i }),
    ).not.toBeInTheDocument();
  });

  it('AC-W6-IXD-NOTE: the read-only branch renders no note affordance (button or input)', () => {
    render(<TimesheetGrid days={days} rows={rows} />);
    expect(
      screen.queryByRole('button', { name: /Add note to Eastfield Logistics Park/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Eastfield Logistics Park note')).not.toBeInTheDocument();
  });

  it('AC-W6-IXD-NOTE: typing in the expanded input still fires onNoteChange', async () => {
    const onNoteChange = vi.fn();
    render(
      <TimesheetGrid
        days={days}
        rows={rows}
        editable
        notes={{ r1: '' }}
        onNoteChange={onNoteChange}
      />,
    );
    // Empty note → expand first.
    await userEvent.click(screen.getByRole('button', { name: /Add note to Eastfield Logistics Park/i }));
    await userEvent.type(screen.getByLabelText('Eastfield Logistics Park note'), 'x');
    expect(onNoteChange).toHaveBeenCalledWith('r1', 'x');
  });
});
