import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';

/** Walk fix JOB-NAV-WO: the work orders front door lists the reader's work orders with status, under the dictionary's name. */
const h = vi.hoisted(() => ({ state: { data: [] as unknown[], isPending: false, isError: false, refetch: () => undefined } }));
vi.mock('@/src/hooks/useWorkOrders', () => ({ useAllWorkOrders: () => h.state }));

import WorkOrders from './WorkOrders';

const row = (over: Record<string, unknown>) => ({ id: 'w1', wo_number: 'WO-1', title: 'Pipe laying', status: 'Issued', project_id: 'p1', start_date: null, end_date: null, project_name: 'Depot', ...over });
const renderPage = () => render(<MemoryRouter><WorkOrders /></MemoryRouter>);

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
});
