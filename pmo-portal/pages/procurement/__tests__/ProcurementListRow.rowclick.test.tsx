/**
 * AC-ROWCLICK-PROCLIST-* — ProcurementListRow is a NAVIGATION list row: a
 * whole-row click navigates to the detail page (/procurement/:id). Nested
 * controls keep their own behaviour: the disclosure chevron expands the in-place
 * preview (does NOT navigate), and the inner links (title, project name) navigate
 * via their own href without double-firing the row navigation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: () => ({
    data: null,
    isPending: true,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

import { ProcurementListRow } from '../ProcurementListRow';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';

const makeRow = (over: Partial<ProcurementWithRefs> = {}): ProcurementWithRefs =>
  ({
    id: 'pr-1',
    code: 'PR-0001',
    title: 'Crane Hire',
    status: 'Requested',
    total_value: 25000,
    created_at: '2026-06-01T00:00:00Z',
    project_id: 'project-xyz',
    requested_by_id: 'u1',
    project: { name: 'Harbour Bridge', code: 'HB-01' },
    requested_by: { full_name: 'Alice Engineer' },
    vendor: null,
    vendor_id: null,
    ...over,
  }) as ProcurementWithRefs;

const wrap = (row: ProcurementWithRefs) =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <ProcurementListRow row={row} />
      </ToastProvider>
    </MemoryRouter>,
  );

beforeEach(() => navigateMock.mockReset());

describe('AC-ROWCLICK-PROCLIST: whole-row click navigates to the detail page', () => {
  it('AC-ROWCLICK-PROCLIST-1: clicking the row body (the code text) navigates to /procurement/:id', async () => {
    wrap(makeRow());
    // The request code is a plain (non-interactive) cell — clicking it is a
    // whole-row click that should navigate.
    await userEvent.click(screen.getByText('PR-0001'));
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith('/procurement/pr-1');
  });

  it('AC-ROWCLICK-PROCLIST-2: clicking the disclosure chevron does NOT navigate (it expands)', async () => {
    wrap(makeRow());
    const chevron = screen.getByRole('button', { name: /show preview for/i });
    await userEvent.click(chevron);
    expect(navigateMock).not.toHaveBeenCalled();
    // The chevron toggled the preview open.
    expect(chevron).toHaveAttribute('aria-expanded', 'true');
  });

  it('AC-ROWCLICK-PROCLIST-3: clicking the project-name link does NOT fire imperative row navigation', async () => {
    wrap(makeRow());
    const projectLink = screen.getByRole('link', { name: 'Open Harbour Bridge' });
    await userEvent.click(projectLink);
    // The inner <Link> navigates declaratively (href); the row's imperative
    // navigate() must NOT also fire (would race the project link).
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('AC-ROWCLICK-PROCLIST-4: the row summary carries a cursor-pointer affordance', () => {
    const { container } = wrap(makeRow());
    // The clickable row-summary wrapper (the flex header div) signals affordance.
    const summary = container.querySelector('[data-row-activate]')!;
    expect(summary).toBeTruthy();
    expect(summary.className).toContain('cursor-pointer');
  });
});
