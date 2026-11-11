/**
 * #2061 — phone bottom navigation: Home, Approvals, Search, and More.
 *
 * Behaviour under test (not looks): Home plus the role-appropriate approval/task destination,
 * Search, and More appear below the phone breakpoint; Home points to and is active on the dashboard,
 * and More opens the existing rail drawer through the callback the shell owns.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { PhoneNavBar } from '../PhoneNavBar';

const state = vi.hoisted(() => ({
  narrow: true,
  role: 'Project Manager' as string,
  eligibleDecisions: false,
  features: {} as Record<string, boolean>,
}));

vi.mock('@/src/components/ui/useIsNarrow', () => ({ useIsNarrow: () => state.narrow }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: state.role, realRole: state.role }),
}));
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({ data: state.features, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => ({ data: state.eligibleDecisions ? [{}] : [], isPending: false, isError: false }),
  useReopenableApprovedTimesheets: () => ({ data: [], isPending: false, isError: false }),
}));

const renderBar = (entry = '/', moreOpen = false) => {
  const onOpenMore = vi.fn();
  const onOpenSearch = vi.fn();
  const view = render(
    <MemoryRouter initialEntries={[entry]}>
      <PhoneNavBar onOpenMore={onOpenMore} onOpenSearch={onOpenSearch} moreOpen={moreOpen} />
    </MemoryRouter>,
  );
  return { ...view, onOpenMore, onOpenSearch };
};

const linkNames = () =>
  within(screen.getByRole('navigation', { name: 'Phone navigation' }))
    .getAllByRole('link')
    .map((a) => a.textContent);

beforeEach(() => {
  state.narrow = true;
  state.role = 'Project Manager';
  state.eligibleDecisions = false;
  state.features = { revenue: true, procurement: true, timesheets: true };
});

afterEach(() => vi.clearAllMocks());

describe('#2061 phone bottom navigation', () => {
  it.each(['Executive', 'Project Manager', 'Finance', 'Admin'])('%s gets the fixed destinations in order', (role) => {
    state.role = role;
    renderBar();
    expect(linkNames()).toEqual(role === 'Executive' ? ['Home', 'Approvals'] : ['Home', 'Approvals', 'My Tasks']);
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Phone navigation' }).querySelectorAll('svg')).toHaveLength(role === 'Executive' ? 4 : 5);
  });

  it('gives an Engineer without eligible decisions Home and My Tasks', () => {
    state.role = 'Engineer';
    renderBar();
    expect(linkNames()).toEqual(['Home', 'My Tasks']);
    expect(screen.getByRole('link', { name: 'My Tasks' })).toHaveAttribute('href', '/my-tasks');
    expect(screen.queryByRole('link', { name: 'Approvals' })).not.toBeInTheDocument();
  });

  it('shows both fixed role destinations when an Engineer has eligible decisions', () => {
    state.role = 'Engineer';
    state.eligibleDecisions = true;
    renderBar();
    expect(linkNames()).toEqual(['Home', 'Approvals', 'My Tasks']);
  });

  it('points Home at the dashboard and Approvals at the shared approval queue', () => {
    state.role = 'Finance';
    renderBar();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Approvals' })).toHaveAttribute('href', '/approvals');
  });

  it('keeps the fixed role destinations independent of unrelated org features', () => {
    state.role = 'Engineer';
    state.features = { timesheets: false, expenses: false, procurement: false, revenue: false };
    renderBar();
    expect(linkNames()).toEqual(['Home', 'My Tasks']);
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
  });

  it('is absent above the phone breakpoint (desktop keeps the rail + header)', () => {
    state.narrow = false;
    renderBar();
    expect(screen.queryByRole('navigation', { name: 'Phone navigation' })).not.toBeInTheDocument();
  });

  it('marks Home active only on the dashboard route', () => {
    renderBar('/');
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Approvals' })).not.toHaveAttribute('aria-current');
  });

  it('keeps a job current on its child pages', () => {
    renderBar('/approvals/expense');
    expect(screen.getByRole('link', { name: 'Approvals' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });

  it('marks My Tasks current on its child pages for roles without Approvals', () => {
    state.role = 'Engineer';
    renderBar('/my-tasks/project-1');
    expect(screen.getByRole('link', { name: 'My Tasks' })).toHaveAttribute('aria-current', 'page');
  });

  it('Search opens the existing command palette', async () => {
    const { onOpenSearch } = renderBar();
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it('More opens the existing full navigation and reports its open state', async () => {
    const { onOpenMore } = renderBar('/', true);
    const more = screen.getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(more).toHaveAttribute('data-drawer-toggle');
    await userEvent.click(more);
    expect(onOpenMore).toHaveBeenCalledTimes(1);
  });

  it('every item clears the 44px touch target', () => {
    renderBar();
    for (const el of [...screen.getAllByRole('link'), screen.getByRole('button', { name: 'Search' }), screen.getByRole('button', { name: 'More' })]) {
      expect(el.className).toContain('min-h-11');
      expect(el.className).toContain('touch-target');
    }
  });
});
