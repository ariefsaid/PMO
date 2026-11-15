/**
 * #2061 — phone bottom navigation: Dashboard, the role's most-used places, Search, and More.
 *
 * Behaviour under test (not looks): Dashboard plus the role's most-used destinations (gated exactly like the rail),
 * Search, and More appear below the phone breakpoint; Dashboard points to and is active on the dashboard,
 * and More opens the existing rail drawer through the callback the shell owns.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import i18next from 'i18next';
import { act } from '@testing-library/react';
import { PhoneNavBar } from '../PhoneNavBar';
import idHome from '../../../../public/locales/id/home.json';
import idCommon from '../../../../public/locales/id/common.json';

const state = vi.hoisted(() => ({
  narrow: true,
  role: 'Project Manager' as string,
  realRole: null as string | null,
  eligibleDecisions: false,
  features: {} as Record<string, boolean>,
}));

vi.mock('@/src/components/ui/useIsNarrow', () => ({ useIsNarrow: () => state.narrow }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: state.role, realRole: state.realRole ?? state.role }),
}));
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({ data: state.features, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useHasTimesheetApprovalWork: () => ({ data: state.eligibleDecisions, isPending: false, isError: false }),
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

const slotNames = () =>
  [...screen.getByRole('navigation', { name: 'Phone navigation' }).querySelectorAll('a, button')]
    .map((element) => element.getAttribute('aria-label') ??
      [...element.querySelectorAll('span')].at(-1)?.textContent?.trim());

beforeEach(() => {
  state.narrow = true;
  state.role = 'Project Manager';
  state.realRole = null;
  state.eligibleDecisions = false;
  state.features = { revenue: true, procurement: true, timesheets: true };
});

afterEach(() => vi.clearAllMocks());

describe('#2061 phone bottom navigation', () => {
  it.each([
    ['Executive', ['Dashboard', 'Approvals', 'Finance', 'Search', 'More']],
    ['Project Manager', ['Dashboard', 'Approvals', 'Projects', 'Search', 'More']],
    ['Finance', ['Dashboard', 'Approvals', 'Finance', 'Search', 'More']],
    ['Admin', ['Dashboard', 'Approvals', 'Projects', 'Search', 'More']],
  ])('%s gets its own most-used places within thumb reach', (role, expected) => {
    state.role = role;
    renderBar();
    expect(slotNames()).toEqual(expected);
  });

  it('gives an Engineer without eligible decisions Dashboard, My Tasks and Timesheets', () => {
    state.role = 'Engineer';
    renderBar();
    expect(linkNames()).toEqual(['Dashboard', 'My Tasks', 'Timesheets']);
    expect(slotNames()).toEqual(['Dashboard', 'My Tasks', 'Timesheets', 'Search', 'More']);
    expect(screen.getByRole('link', { name: 'My Tasks' })).toHaveAttribute('href', '/my-tasks');
    expect(screen.getByRole('link', { name: 'Timesheets' })).toHaveAttribute('href', '/timesheets');
    expect(screen.queryByRole('link', { name: 'Approvals' })).not.toBeInTheDocument();
  });

  it('puts Approvals first for an Engineer with eligible decisions', () => {
    state.role = 'Engineer';
    state.eligibleDecisions = true;
    renderBar();
    expect(linkNames()).toEqual(['Dashboard', 'Approvals', 'My Tasks']);
  });

  it('points Dashboard at the dashboard, Approvals at the shared queue and Finance at the finance overview', () => {
    state.role = 'Finance';
    renderBar();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Approvals' })).toHaveAttribute('href', '/approvals');
    expect(screen.getByRole('link', { name: 'Finance' })).toHaveAttribute('href', '/finance');
  });

  it('never offers a place the rail would not: a switched-off module falls through to the next one', () => {
    state.role = 'Engineer';
    state.features = { timesheets: false, expenses: false, procurement: false, revenue: false };
    renderBar();
    expect(linkNames()).toEqual(['Dashboard', 'My Tasks', 'Projects']);
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
  });

  it('keeps Finance off the bar while a non-finance person previews the Finance role', () => {
    state.role = 'Finance';
    state.realRole = 'Project Manager';
    renderBar();
    expect(screen.queryByRole('link', { name: 'Finance' })).not.toBeInTheDocument();
    expect(linkNames()).toEqual(['Dashboard', 'Approvals', 'My Tasks']);
  });

  it('keeps Finance current on the money pages beneath it', () => {
    state.role = 'Finance';
    renderBar('/finance/receivables');
    expect(screen.getByRole('link', { name: 'Finance' })).toHaveAttribute('aria-current', 'page');
  });

  it('is absent above the phone breakpoint (desktop keeps the rail + header)', () => {
    state.narrow = false;
    renderBar();
    expect(screen.queryByRole('navigation', { name: 'Phone navigation' })).not.toBeInTheDocument();
  });

  it('marks Dashboard active only on the dashboard route', () => {
    renderBar('/');
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Approvals' })).not.toHaveAttribute('aria-current');
  });

  it('keeps a job current on its child pages', () => {
    renderBar('/approvals/expense');
    expect(screen.getByRole('link', { name: 'Approvals' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
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

describe('#2353 phone bar in Bahasa', () => {
  it('names Approvals and My Tasks with the same words as the page and the drawer', async () => {
    i18next.addResourceBundle('id', 'home', idHome, true, true);
    i18next.addResourceBundle('id', 'common', idCommon, true, true);
    await act(async () => { await i18next.changeLanguage('id'); });
    try {
      state.role = 'Project Manager';
      renderBar();
      const bar = screen.getByRole('navigation');
      expect(within(bar).getByRole('link', { name: /Persetujuan/ })).toHaveAttribute('href', '/approvals');
      expect(within(bar).queryByText('Setuju')).not.toBeInTheDocument();
      expect(within(bar).getByRole('link', { name: /Persetujuan/ }).textContent).toBe(idCommon.shell.nav.approvals);
    } finally {
      await act(async () => { await i18next.changeLanguage('en'); });
    }
  });
});
