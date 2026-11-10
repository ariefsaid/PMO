/**
 * #2061 — phone bottom navigation: the role's three jobs and "More".
 *
 * Behaviour under test (not looks): the bar exists only below the phone breakpoint, each role gets
 * ITS jobs (destinations the sidebar already offers that role), entitlement-gated jobs stay hidden
 * when the entitlement is off, the active destination carries `aria-current="page"`, and More opens
 * the existing rail drawer through the callback the shell owns.
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
  features: {} as Record<string, boolean>,
}));

vi.mock('@/src/components/ui/useIsNarrow', () => ({ useIsNarrow: () => state.narrow }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: state.role, realRole: state.role }),
}));
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({ data: state.features, isPending: false, isError: false }),
}));

const renderBar = (entry = '/home', moreOpen = false) => {
  const onOpenMore = vi.fn();
  const view = render(
    <MemoryRouter initialEntries={[entry]}>
      <PhoneNavBar onOpenMore={onOpenMore} moreOpen={moreOpen} />
    </MemoryRouter>,
  );
  return { ...view, onOpenMore };
};

const linkNames = () =>
  within(screen.getByRole('navigation', { name: 'Phone navigation' }))
    .getAllByRole('link')
    .map((a) => a.textContent);

beforeEach(() => {
  state.narrow = true;
  state.role = 'Project Manager';
  state.features = { revenue: true, procurement: true, timesheets: true };
});

afterEach(() => vi.clearAllMocks());

describe('#2061 phone bottom navigation', () => {
  it.each([
    ['Executive', ['Home', 'Projects', 'Finance']],
    ['Project Manager', ['Home', 'Projects', 'Approvals']],
    ['Finance', ['Home', 'Receivables', 'Payables']],
    ['Engineer', ['Home', 'Timesheets', 'Expenses']],
    ['Admin', ['Home', 'Approvals', 'Admin']],
  ])('%s gets its own three jobs plus More', (role, expected) => {
    state.role = role;
    renderBar();
    expect(linkNames()).toEqual(expected);
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
  });

  it('points each job at the destination the sidebar already offers', () => {
    state.role = 'Finance';
    renderBar();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/home');
    expect(screen.getByRole('link', { name: 'Receivables' })).toHaveAttribute('href', '/finance/receivables');
    expect(screen.getByRole('link', { name: 'Payables' })).toHaveAttribute('href', '/finance/payables');
  });

  it('drops a job whose entitlement is off (same gate as the sidebar)', () => {
    state.role = 'Engineer';
    state.features = { timesheets: false };
    renderBar();
    expect(linkNames()).toEqual(['Home', 'Expenses']);
  });

  it('is absent above the phone breakpoint (desktop keeps the rail + header)', () => {
    state.narrow = false;
    renderBar();
    expect(screen.queryByRole('navigation', { name: 'Phone navigation' })).not.toBeInTheDocument();
  });

  it('marks the active destination with aria-current="page" and only that one', () => {
    renderBar('/home');
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Approvals' })).not.toHaveAttribute('aria-current');
  });

  it('keeps a job current on its child pages', () => {
    renderBar('/projects/p-1');
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });

  it('More opens the existing full navigation and reports its open state', async () => {
    const { onOpenMore } = renderBar('/home', true);
    const more = screen.getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(more);
    expect(onOpenMore).toHaveBeenCalledTimes(1);
  });

  it('every item clears the 44px touch target', () => {
    renderBar();
    for (const el of [...screen.getAllByRole('link'), screen.getByRole('button', { name: 'More' })]) {
      expect(el.className).toContain('min-h-11');
      expect(el.className).toContain('touch-target');
    }
  });
});
