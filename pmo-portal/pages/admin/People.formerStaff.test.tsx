import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import type { Role } from '@/src/auth/AuthContext';

/**
 * AC-FSF-003..008 — the former-staff filter on the People register (#2703).
 * The job: lists stay clean by default, and former staff are one choice away, still on record.
 */
const active = { id: 'p1', code: 'P-0001', name: 'Budi Santoso', job_title: 'Welder', profile_id: null, archived_at: null };
const former = { id: 'p2', code: 'P-0009', name: 'Ayu Lestari', job_title: 'Helper', profile_id: null, archived_at: '2026-10-01T00:00:00Z' };

const h = vi.hoisted(() => ({
  role: 'Admin' as string,
  statusCalls: [] as string[],
  rows: [] as unknown[],
  markLeft: vi.fn(),
}));

vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role as Role, effectiveRole: h.role as Role }) }));
vi.mock('@/src/hooks/usePeople', () => ({
  usePeople: (status: string = 'active') => {
    h.statusCalls.push(status);
    const data = status === 'active' ? h.rows.filter((r) => !(r as { archived_at: unknown }).archived_at)
      : status === 'former' ? h.rows.filter((r) => Boolean((r as { archived_at: unknown }).archived_at))
        : h.rows;
    return { data, isPending: false, isError: false, refetch: vi.fn() };
  },
  usePeopleMutations: () => ({ create: { mutateAsync: vi.fn() }, update: { mutateAsync: vi.fn() }, markLeft: { mutateAsync: h.markLeft, isPending: false } }),
}));
vi.mock('@/src/hooks/useOrgProfilesLoader', () => ({ useOrgProfilesLoader: () => () => Promise.resolve([]) }));

import People from './People';

const LocationProbe = () => <span data-testid="search">{useLocation().search}</span>;
const renderPage = (url = '/administration/people') => render(
  <MemoryRouter initialEntries={[url]}><ToastProvider><People /><LocationProbe /></ToastProvider></MemoryRouter>,
);

describe('People register former-staff filter (#2703)', () => {
  beforeEach(() => {
    h.role = 'Admin';
    h.statusCalls = [];
    h.rows = [active, former];
    h.markLeft.mockReset().mockResolvedValue(undefined);
  });

  it('AC-FSF-003 opens on Active, with the three staff-status choices offered', () => {
    renderPage();
    expect(h.statusCalls.at(-1)).toBe('active');
    const group = screen.getByRole('group', { name: 'Staff status' });
    expect(within(group).getByRole('button', { name: 'Active' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'Former staff' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(group).getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.queryByText('Ayu Lestari')).toBeNull();
  });

  it('AC-FSF-004 choosing Former staff reads former staff and names each row', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Former staff' }));
    expect(h.statusCalls.at(-1)).toBe('former');
    const row = screen.getByRole('row', { name: /Ayu Lestari/ });
    expect(within(row).getByText('Former staff')).toBeInTheDocument();
    expect(screen.queryByText('Budi Santoso')).toBeNull();
  });

  it('AC-FSF-005 All lists both, each row naming its status', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(within(screen.getByRole('row', { name: /Budi Santoso/ })).getByText('Active')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Ayu Lestari/ })).getByText('Former staff')).toBeInTheDocument();
  });

  it('AC-FSF-006 a former-staff row opens the person record but offers no edit or mark as left', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Former staff' }));
    expect(screen.getByRole('link', { name: 'Ayu Lestari' })).toHaveAttribute('href', '/equipment/people/p2');
    expect(screen.queryByRole('button', { name: /Edit Ayu Lestari/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Mark Ayu Lestari as left/ })).toBeNull();
  });

  it('AC-FSF-007 an empty Former staff view names it and offers no add', async () => {
    h.rows = [active];
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Former staff' }));
    const empty = screen.getByText(/No former staff/).parentElement as HTMLElement;
    expect(within(empty).queryByRole('button', { name: 'Add person' })).toBeNull();
  });

  it('AC-FSF-008 the chosen view lives in the URL, so a link reproduces it', async () => {
    const user = userEvent.setup();
    renderPage('/administration/people?staff=former');
    expect(h.statusCalls.at(-1)).toBe('former');
    expect(screen.getByTestId('search')).toHaveTextContent('?staff=former');
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByTestId('search')).toHaveTextContent('?staff=all');
  });
});
