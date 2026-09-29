/**
 * AC-ROWCLICK-PROCLIST-* — ProcurementListRow is a NAVIGATION list row: a
 * whole-row click navigates to the detail page (/procurement/:id). Nested
 * controls keep their own behaviour: the disclosure chevron expands the in-place
 * preview (does NOT navigate), and the inner links (title, project name) navigate
 * via their own href without double-firing the row navigation.
 *
 * list-working-set-return (#682, AC-LRC-005): the row's open paths now go through
 * `useListReturn({list:'procurement'}).openRecord`, which captures the current Procurement list
 * URL + scroll as validated return context before calling the real router `navigate`. Tests
 * mount at the list's own canonical `/procurement` path (openRecord only captures context from
 * there) and read the REAL location to assert both the destination and the captured state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: () => ({
    data: null,
    isPending: true,
    isError: false,
    refetch: vi.fn(),
  }),
}));

import { ProcurementListRow } from '../ProcurementListRow';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';

const makeRow = (over: Partial<ProcurementWithRefs> = {}): ProcurementWithRefs =>
  ({
    id: 'pr-1',
    code: 'PR-0001',
    title: 'Crane Hire',
    status: 'Requested',
    total_value: 25000,
    currency: 'USD',
    created_at: '2026-06-01T00:00:00Z',
    project_id: 'project-xyz',
    requested_by_id: 'u1',
    project: { name: 'Harbour Bridge', code: 'HB-01' },
    requested_by: { full_name: 'Alice Engineer' },
    vendor: null,
    vendor_id: null,
    ...over,
  }) as ProcurementWithRefs;

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return (
    <div
      data-testid="location-probe"
      data-pathname={location.pathname}
      data-state={JSON.stringify(location.state ?? null)}
    />
  );
};

const wrap = (row: ProcurementWithRefs) =>
  render(
    <MemoryRouter initialEntries={['/procurement']}>
      <LocationProbe />
      <ToastProvider>
        <ProcurementListRow row={row} />
      </ToastProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  sessionStorage.clear();
});

describe('AC-ROWCLICK-PROCLIST: whole-row click navigates to the detail page', () => {
  it('AC-ROWCLICK-PROCLIST-1 / AC-LRC-005: clicking the row body (the code text) navigates to /procurement/:id, carrying validated Procurement list-return context', async () => {
    wrap(makeRow());
    // The request code is a plain (non-interactive) cell — clicking it is a
    // whole-row click that should navigate.
    await userEvent.click(screen.getByText('PR-0001'));
    const probe = screen.getByTestId('location-probe');
    await waitFor(() => expect(probe.dataset.pathname).toBe('/procurement/pr-1'));
    const state = JSON.parse(probe.dataset.state ?? 'null') as Record<string, unknown>;
    expect(state.pmoListReturn).toMatchObject({ list: 'procurement' });
  });

  it('AC-ROWCLICK-PROCLIST-2: clicking the disclosure chevron does NOT navigate (it expands)', async () => {
    wrap(makeRow());
    const chevron = screen.getByRole('button', { name: /show preview for/i });
    await userEvent.click(chevron);
    expect(screen.getByTestId('location-probe').dataset.pathname).toBe('/procurement');
    // The chevron toggled the preview open.
    expect(chevron).toHaveAttribute('aria-expanded', 'true');
  });

  it('AC-ROWCLICK-PROCLIST-3: clicking the project-name link does NOT fire imperative row navigation', async () => {
    wrap(makeRow());
    const projectLink = screen.getByRole('link', { name: 'Open Harbour Bridge' });
    await userEvent.click(projectLink);
    // The inner <Link> navigates declaratively to ITS OWN destination (the project); the row's
    // imperative openRecord() must NOT also fire and redirect to the PR detail instead.
    expect(screen.getByTestId('location-probe').dataset.pathname).toBe('/projects/project-xyz');
  });

  it('AC-ROWCLICK-PROCLIST-4: the row summary carries a cursor-pointer affordance', () => {
    const { container } = wrap(makeRow());
    // The clickable row-summary wrapper (the flex header div) signals affordance.
    const summary = container.querySelector('[data-row-activate]')!;
    expect(summary).toBeTruthy();
    expect(summary.className).toContain('cursor-pointer');
  });

  it('AC-LRC-005: clicking the title link navigates to /procurement/:id, carrying validated Procurement list-return context', async () => {
    wrap(makeRow());
    const titleLink = screen.getByRole('link', { name: 'Crane Hire' });
    await userEvent.click(titleLink);
    const probe = screen.getByTestId('location-probe');
    await waitFor(() => expect(probe.dataset.pathname).toBe('/procurement/pr-1'));
    const state = JSON.parse(probe.dataset.state ?? 'null') as Record<string, unknown>;
    expect(state.pmoListReturn).toMatchObject({ list: 'procurement' });
  });
});
