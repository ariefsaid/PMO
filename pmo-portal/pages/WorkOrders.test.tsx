import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { orgToday } from '@/src/lib/checklistDue';
import { getActiveLocale } from '@/src/lib/locale/activeLocale';

/** Walk fix JOB-NAV-WO: the work orders front door lists the reader's work orders with status, under the dictionary's name. */
const h = vi.hoisted(() => ({
  state: { data: [] as unknown[], isPending: false, isError: false, refetch: () => undefined },
  due: { data: [] as unknown[], isPending: false, isError: false },
}));
vi.mock('@/src/hooks/useWorkOrders', () => ({ useAllWorkOrders: () => h.state }));
vi.mock('@/src/hooks/useCloseoutChecklist', () => ({ useOpenCloseoutDue: () => h.due }));

import WorkOrders from './WorkOrders';

const row = (over: Record<string, unknown>) => ({ id: 'w1', wo_number: 'WO-1', title: 'Pipe laying', status: 'Issued', project_id: 'p1', start_date: null, end_date: null, project_name: 'Depot', ...over });
const renderPage = () => render(<MemoryRouter><WorkOrders /></MemoryRouter>);

/** A day relative to the organisation's own day, so the count never depends on when the suite runs. */
const shift = (isoDay: string, days: number) => {
  const d = new Date(`${isoDay}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

beforeEach(() => {
  h.state = { ...h.state, data: [], isPending: false, isError: false };
  h.due = { data: [], isPending: false, isError: false };
});

describe('WorkOrders page', () => {
  it('lists each work order with its status and links to it', () => {
    h.state = { ...h.state, data: [row({}), row({ id: 'w2', wo_number: 'WO-2', title: 'Fencing', status: 'Draft', project_name: 'Yard' })] };
    renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Work order');
    const first = screen.getByRole('link', { name: /WO-1 · Pipe laying/ });
    expect(first).toHaveAttribute('href', '/work-orders/w1');
    expect(first).toHaveTextContent('Issued');
    expect(screen.getByRole('link', { name: /WO-2/ })).toHaveTextContent('Draft');
  });

  it('filters by number, title or project', async () => {
    h.state = { ...h.state, data: [row({}), row({ id: 'w2', wo_number: 'WO-2', title: 'Fencing', project_name: 'Yard' })] };
    renderPage();
    await userEvent.type(screen.getByRole('searchbox'), 'yard');
    expect(screen.queryByRole('link', { name: /WO-1/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /WO-2/ })).toBeInTheDocument();
  });

  it('says so when there is none, and offers a retry on error', () => {
    h.state = { ...h.state, data: [] };
    const { unmount } = renderPage();
    expect(screen.getByText('You have no work orders yet')).toBeInTheDocument();
    unmount();
    h.state = { ...h.state, isError: true };
    renderPage();
    expect(screen.getByText("Couldn't load your work orders")).toBeInTheDocument();
  });

  it('AC-CTD-010 shows how many close-out items are overdue on each work order', () => {
    const today = orgToday(new Date(), getActiveLocale().timezone);
    h.state = { ...h.state, data: [row({}), row({ id: 'w2', wo_number: 'WO-2', title: 'Fencing', project_name: 'Yard' })] };
    h.due = {
      ...h.due,
      data: [
        { workOrderId: 'w1', dueOn: shift(today, -1), doneOn: null },
        { workOrderId: 'w1', dueOn: shift(today, -9), doneOn: null },
        { workOrderId: 'w1', dueOn: today, doneOn: null }, // due today: not overdue
        { workOrderId: 'w2', dueOn: shift(today, -3), doneOn: null },
      ],
    };
    renderPage();
    expect(screen.getByTestId('work-order-overdue-w1')).toHaveTextContent('Overdue: 2');
    expect(screen.getByTestId('work-order-overdue-w2')).toHaveTextContent('Overdue: 1');
  });

  it('AC-CTD-010 an organisation with no targeted items shows no overdue marker at all', () => {
    h.state = { ...h.state, data: [row({})] };
    renderPage();
    expect(screen.queryByTestId('work-order-overdue-w1')).toBeNull();
    expect(screen.getByRole('link', { name: /WO-1 · Pipe laying/ })).toBeInTheDocument();
  });
});
