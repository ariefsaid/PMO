/**
 * #2061 — phone bottom navigation (Home · Approvals · Search · More).
 *
 * Behaviour under test (not looks): the bar exists only below the phone breakpoint, it names the
 * SAME destinations the app already has (no new data path), role-hidden items stay hidden, the
 * active destination carries `aria-current="page"`, and the two button items open the existing
 * command palette / rail drawer through the callbacks the shell already owns.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { PhoneNavBar } from '../PhoneNavBar';

const state = vi.hoisted(() => ({
  narrow: true,
  canApprove: true,
  role: 'Project Manager' as string,
}));

vi.mock('@/src/components/ui/useIsNarrow', () => ({ useIsNarrow: () => state.narrow }));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) =>
    state.canApprove && (entity === 'procurement' || entity === 'approval' || entity === 'salesInvoice'),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: state.role, realRole: state.role }),
}));

const renderBar = (entry = '/home', moreOpen = false) => {
  const onOpenSearch = vi.fn();
  const onOpenMore = vi.fn();
  const view = render(
    <MemoryRouter initialEntries={[entry]}>
      <PhoneNavBar onOpenSearch={onOpenSearch} onOpenMore={onOpenMore} moreOpen={moreOpen} />
    </MemoryRouter>,
  );
  return { ...view, onOpenSearch, onOpenMore };
};

beforeEach(() => {
  state.narrow = true;
  state.canApprove = true;
  state.role = 'Project Manager';
});

afterEach(() => vi.clearAllMocks());

describe('#2061 phone bottom navigation', () => {
  it('renders a labelled nav landmark with the four destinations on a phone', () => {
    renderBar();
    const nav = screen.getByRole('navigation', { name: 'Phone navigation' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/home');
    expect(screen.getByRole('link', { name: 'Approvals' })).toHaveAttribute('href', '/approvals');
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
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

    renderBar('/approvals');
    const approvals = screen.getAllByRole('link', { name: 'Approvals' })[1];
    expect(approvals).toHaveAttribute('aria-current', 'page');
  });

  it('leaves no item current on an unrelated screen (e.g. a project record)', () => {
    renderBar('/projects/p-1');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Approvals' })).not.toHaveAttribute('aria-current');
  });

  it('hides Approvals for a role that cannot approve anything (same gate as the sidebar)', () => {
    state.canApprove = false;
    state.role = 'Engineer';
    renderBar();
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Approvals' })).not.toBeInTheDocument();
    // Search + More stay available to every role.
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
  });

  it('Search opens the existing command palette through the shell callback', async () => {
    const { onOpenSearch } = renderBar();
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
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
    for (const el of [
      screen.getByRole('link', { name: 'Home' }),
      screen.getByRole('link', { name: 'Approvals' }),
      screen.getByRole('button', { name: 'Search' }),
      screen.getByRole('button', { name: 'More' }),
    ]) {
      expect(el.className).toContain('min-h-11');
      expect(el.className).toContain('touch-target');
    }
  });
});
