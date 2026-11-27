/**
 * Walk fix: finding things. The menu has a front door for work orders, a Safety entry (only where the module is on),
 * People first for HR, and orders itself by what the person's function does daily (HR never sees Sales or Finance).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import React from 'react';
import { Rail } from '../Rail';
import { RailDrawerContext } from '../railDrawerContext';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';

const state = vi.hoisted(() => ({ role: 'Project Manager', key: 'hr_manager' as string | null, safety: false }));

const standing = vi.hoisted(() => ({ offered: true }));
vi.mock('@/src/hooks/useWaitingForYou', () => ({ useApprovalsEntryOffered: () => standing.offered }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: state.role, realRole: state.role }) }));
vi.mock('@/src/hooks/useOrgFeatures', () => ({ useOrgFeatures: () => ({
  data: { crm: true, procurement: true, timesheets: true, revenue: true, management_pack: true, financial_statements: true, imprest: true, stock: true, sales_pipeline: true, incidents: true },
}) }));
vi.mock('@/src/hooks/useUserViews', () => ({ useUserViews: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({ useHasTimesheetApprovalWork: () => ({ data: false }) }));
vi.mock('@/src/hooks/useSafetyDays', () => ({ useSafetyMenuOn: () => state.safety }));
vi.mock('../ApprovalsNavCount', () => ({ ApprovalsNavCount: () => null }));
vi.mock('@/src/hooks/useOverdueInvoiceCount', () => ({ useOverdueInvoiceCount: () => ({ isPending: true }) }));
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => () => true,
  useBuiltInRoleKey: () => state.key,
}));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: () => false }));

const renderRail = () => {
  const auth = { currentUser: { id: 'me', org_id: 'org-1', built_in_role: state.key } } as unknown as AuthContextValue;
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter><RailDrawerContext.Provider value><Rail /></RailDrawerContext.Provider></MemoryRouter>
    </AuthContext.Provider>,
  );
};
const hrefs = () => [...screen.getByRole('navigation', { name: 'Primary navigation' }).querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
const headings = () => [...screen.getByRole('navigation', { name: 'Primary navigation' }).querySelectorAll('button[aria-expanded]')].map((b) => b.textContent);

beforeEach(() => { localStorage.clear(); state.role = 'Project Manager'; state.key = 'hr_manager'; state.safety = false; });

describe('walk fix — menu entries and daily order', () => {
  it('MT3: reveals My Tasks after the role and later navigation items arrive', async () => {
    state.key = 'project_manager';
    state.role = '';
    const revealed: HTMLElement[] = [];
    const previous = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function () { revealed.push(this); };
    const tree = () => <AuthContext.Provider value={{ currentUser: { id: 'me', org_id: 'org-1', built_in_role: state.key } } as unknown as AuthContextValue}><MemoryRouter initialEntries={['/my-tasks']}><RailDrawerContext.Provider value><Rail /></RailDrawerContext.Provider></MemoryRouter></AuthContext.Provider>;
    try {
      const page = render(tree());
      state.role = 'Project Manager';
      page.rerender(tree());
      const destination = screen.getByRole('link', { name: 'My Tasks' });
      expect(destination).toHaveAttribute('aria-current', 'page');
      expect(revealed).toContain(destination);
      const initialReveals = revealed.filter((item) => item === destination).length;
      state.safety = true;
      page.rerender(tree());
      await waitFor(() => expect(revealed.filter((item) => item === destination).length).toBeGreaterThan(initialReveals));
    } finally {
      HTMLElement.prototype.scrollIntoView = previous;
    }
  });

  it('JOB-NAV-WO: every role has a Work orders entry, named by the terminology dictionary', () => {
    state.key = 'project_manager';
    renderRail();
    expect(screen.getByRole('link', { name: 'Work order' })).toHaveAttribute('href', '/work-orders');
  });

  it('JOB-NAV-SAFETY: Safety appears only when the organisation switched the module on', () => {
    state.key = 'project_manager';
    const off = renderRail();
    expect(hrefs()).not.toContain('/safety');
    off.unmount();
    state.safety = true;
    renderRail();
    expect(hrefs()).toContain('/safety');
  });

  it('JOB-NAV-ASSETS: the equipment asset register has its own entry, and Equipment is not lit on it', () => {
    state.key = 'equipment_manager';
    renderRail();
    expect(hrefs()).toContain('/equipment/assets');
  });

  it('JOB-NAV-PEOPLE: HR gets People right after Home, no Sales or Finance headings, My work first', () => {
    renderRail();
    const list = hrefs();
    expect(list).toContain('/administration/people');
    expect(list.indexOf('/administration/people')).toBeLessThan(list.indexOf('/projects'));
    expect(headings()).toEqual(['My work', 'Delivery']);
  });

  it('JOB-NAV-ORDER: a storekeeper opens Delivery on stock before the rest', () => {
    state.role = 'Engineer'; state.key = 'storekeeper';
    renderRail();
    const list = hrefs();
    expect(list.indexOf('/stock')).toBeLessThan(list.indexOf('/projects'));
    expect(headings()[0]).toBe('Delivery');
  });

  it('JOB-NAV-CASH: Finance keeps site cash beside its financial statements and journals', () => {
    state.role = 'Finance'; state.key = 'finance';
    renderRail();
    const cash = screen.getByRole('link', { name: 'Site cash' });
    expect(cash).toHaveAttribute('href', '/imprest');
    expect(cash.closest('[role="group"]')).toHaveAttribute('aria-label', 'Finance');
  });

  it('JOB-NAV-CLAIMS: Finance has the billing board in its Finance group', () => {
    state.role = 'Finance'; state.key = 'finance_manager';
    renderRail();
    expect(hrefs()).toContain('/finance/billing-board');
  });

  it('JOB-NAV-APPROVALS: an Engineer who can decide anything keeps the approvals inbox', () => {
    state.role = 'Engineer'; state.key = 'engineer';
    renderRail();
    expect(hrefs()).toContain('/approvals');
  });

  it('JOB-NAV-APPROVALS: an Engineer with no standing has no approvals inbox', () => {
    state.role = 'Engineer'; state.key = 'engineer'; standing.offered = false;
    renderRail();
    expect(hrefs()).not.toContain('/approvals');
    standing.offered = true;
  });

  it('a person with no function key keeps the access level order', () => {
    state.key = null;
    renderRail();
    expect(headings()).toEqual(['Delivery', 'My work', 'Sales']);
  });
});

it('speed: navigation retains the intersection observer and reveals the active link once', async () => {
  const observe = vi.fn();
  const disconnect = vi.fn();
  const construct = vi.fn();
  let intersection: IntersectionObserverCallback;
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { construct(); intersection = callback; }
    observe = observe;
    unobserve = vi.fn();
    disconnect = disconnect;
  });
  const previous = HTMLElement.prototype.scrollIntoView;
  const reveal = vi.fn();
  HTMLElement.prototype.scrollIntoView = reveal;
  let go: ReturnType<typeof useNavigate>;
  function Navigate() { go = useNavigate(); return null; }
  try {
    const auth = { currentUser: { id: 'me', org_id: 'org-1', built_in_role: 'project_manager' } } as unknown as AuthContextValue;
    const page = render(<AuthContext.Provider value={auth}><MemoryRouter initialEntries={['/my-tasks']}><Navigate /><RailDrawerContext.Provider value><Rail /></RailDrawerContext.Provider></MemoryRouter></AuthContext.Provider>);
    const initial = construct.mock.calls.length;
    const link = screen.getByRole('link', { name: 'Work order' });
    act(() => intersection([{ target: link, intersectionRatio: 0 } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(link).toHaveAttribute('inert');
    expect(link.style.opacity).toBe('0');
    act(() => intersection([{ target: link, intersectionRatio: 1 } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(link).not.toHaveAttribute('inert');
    expect(link.style.pointerEvents).toBe('');
    const region = link.closest<HTMLElement>('[data-rail-scroll-region]')!;
    region.scrollTop = 120;
    reveal.mockClear();
    await act(() => go('/work-orders'));
    expect(region.scrollTop).toBe(120);
    expect(construct).toHaveBeenCalledTimes(initial);
    expect(reveal).toHaveBeenCalledTimes(1);
    page.unmount();
  } finally {
    HTMLElement.prototype.scrollIntoView = previous;
    vi.unstubAllGlobals();
  }
});
