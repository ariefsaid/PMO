import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { CrewPunctuality as CrewPunctualityRow, LostTimeResult, PunctualityResult } from '@/src/lib/db/siteCheckpoints';

/** #2594 `/site-reports/crews` (FR-STC-040/041/060): the date-range gate, the missed-target crews with
 * their days, the lost-time-by-cause table with its total, and the empty/error/truncated states. */
const h = vi.hoisted(() => ({
  crews: { isPending: false, isError: false, error: null as unknown, refetch: vi.fn() },
  crewsData: { from: '2026-02-10', to: '2026-03-10', truncated: false, crews: [] as CrewPunctualityRow[] } as PunctualityResult,
  lost: { isPending: false, isError: false, error: null as unknown, refetch: vi.fn() },
  lostData: { from: '2026-02-10', to: '2026-03-10', total_minutes: 0, report_count: 0, rows: [] } as LostTimeResult,
}));
vi.mock('@/src/hooks/useSiteCheckpoints', () => ({
  useCrewPunctuality: () => ({ ...h.crews, data: h.crewsData }),
  useLostTimeByCause: () => ({ ...h.lost, data: h.lostData }),
}));

import CrewPunctuality from './CrewPunctuality';

const crew = (o: Partial<CrewPunctualityRow> = {}): CrewPunctualityRow => ({
  crew_id: 'c1', crew_name: 'Crew Alpha', days: 10, on_time: 7, share_on_time: 0.7,
  day_rows: [
    { work_date: '2026-03-02', work_order_id: 'w1', due_at: '2026-03-02T01:00:00Z', recorded_at: '2026-03-02T01:20:00Z', status: 'late', minutes_late: 20 },
    { work_date: '2026-03-03', work_order_id: 'w2', due_at: '2026-03-03T01:00:00Z', recorded_at: null, status: 'not_started', minutes_late: null },
    { work_date: '2026-03-04', work_order_id: 'w3', due_at: '2026-03-04T01:00:00Z', recorded_at: '2026-03-04T00:59:00Z', status: 'on_time', minutes_late: null },
  ],
  ...o,
});

const view = () => render(<MemoryRouter><ToastProvider><CrewPunctuality /></ToastProvider></MemoryRouter>);

beforeEach(() => {
  h.crews = { isPending: false, isError: false, error: null, refetch: vi.fn() };
  h.crewsData = { from: '2026-02-10', to: '2026-03-10', truncated: false, crews: [] };
  h.lost = { isPending: false, isError: false, error: null, refetch: vi.fn() };
  h.lostData = { from: '2026-02-10', to: '2026-03-10', total_minutes: 0, report_count: 0, rows: [] };
});

describe('CrewPunctuality', () => {
  it('no crews in range shows the empty state', () => {
    view();
    expect(screen.getByText('No crew days in this range')).toBeInTheDocument();
  });

  it('lists each crew with its on-time share as a count of days, never an average of minutes', () => {
    h.crewsData = { ...h.crewsData, crews: [crew()] };
    view();
    const row = screen.getByTestId('crew-c1');
    expect(row).toHaveTextContent('Crew Alpha');
    expect(row).toHaveTextContent('7 of 10 days on time');
    expect(row).toHaveTextContent('70%');
  });

  it('names the missed days with their status, target time and minutes late, capped at five', () => {
    h.crewsData = { ...h.crewsData, crews: [crew({ day_rows: Array.from({ length: 7 }, (_, i) => ({ work_date: `2026-03-0${i + 1}`, work_order_id: `w${i}`, due_at: `2026-03-0${i + 1}T01:00:00Z`, recorded_at: null, status: i % 2 === 0 ? ('late' as const) : ('not_started' as const), minutes_late: i === 0 ? 20 : null })) })] };
    view();
    const row = screen.getByTestId('crew-c1');
    expect(row).toHaveTextContent('Late');
    expect(row).toHaveTextContent('Not started');
    expect(row).toHaveTextContent(/Target/);
    expect(row).toHaveTextContent('20 min late');
    expect(screen.getAllByRole('link', { name: 'Work order' })).toHaveLength(5);
  });

  it('on-time days are not listed as misses', () => {
    h.crewsData = { ...h.crewsData, crews: [crew({ days: 10, on_time: 10, share_on_time: 1, day_rows: [{ work_date: '2026-03-04', work_order_id: 'w3', due_at: '2026-03-04T01:00:00Z', recorded_at: '2026-03-04T00:59:00Z', status: 'on_time', minutes_late: null }] })] };
    view();
    expect(screen.getByTestId('crew-c1')).toHaveTextContent('10 of 10 days on time');
    expect(screen.queryByText('Late')).not.toBeInTheDocument();
    expect(screen.queryByText('Not started')).not.toBeInTheDocument();
  });

  it('the truncation note appears when the database capped the crew list', () => {
    h.crewsData = { ...h.crewsData, truncated: true, crews: [crew()] };
    view();
    expect(screen.getByText('Showing the first 200 crews, lowest share on time first.')).toBeInTheDocument();
  });

  it('a crews read failure surfaces the classifier headline with Retry', async () => {
    h.crews = { isPending: false, isError: true, error: new Error('boom'), refetch: vi.fn() };
    const user = userEvent.setup();
    view();
    expect(screen.getByText('Update failed')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.crews.refetch).toHaveBeenCalledTimes(1);
  });

  it('lost time lists each cause with its duration and the total from the report count', () => {
    h.lostData = { from: '2026-02-10', to: '2026-03-10', total_minutes: 305, report_count: 4, rows: [
      { reason_id: 'r1', label: 'Rain', archived: false, minutes: 185 },
      { reason_id: 'r2', label: 'Permit delay', archived: true, minutes: 120 },
    ] };
    view();
    expect(screen.getByText('Rain')).toBeInTheDocument();
    expect(screen.getByText('Permit delay · Archived')).toBeInTheDocument();
    expect(screen.getByText('3h 05m')).toBeInTheDocument();
    expect(screen.getByText('2h 00m')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('5h 05m')).toBeInTheDocument();
    expect(screen.getByText('From 4 reports')).toBeInTheDocument();
  });

  it('no idle time in range says so', () => {
    view();
    expect(screen.getByText('No idle time recorded in this range')).toBeInTheDocument();
  });

  it('a lost-time read failure surfaces the classifier headline with Retry', async () => {
    h.lost = { isPending: false, isError: true, error: new Error('boom'), refetch: vi.fn() };
    const user = userEvent.setup();
    view();
    expect(screen.getByText('Update failed')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.lost.refetch).toHaveBeenCalledTimes(1);
  });

  it('an inverted or oversized range is refused in place and no query runs', async () => {
    const user = userEvent.setup();
    view();
    const from = screen.getByLabelText('From');
    await user.clear(from);
    await user.type(from, '2026-06-01');
    await user.type(screen.getByLabelText('To'), '2026-03-10');
    expect(screen.getByText('Choose a range of 1 to 92 days.')).toBeInTheDocument();
    expect(screen.queryByText('No crew days in this range')).not.toBeInTheDocument();
    expect(screen.queryByText('No idle time recorded in this range')).not.toBeInTheDocument();
  });
});
