/**
 * #879 — AppShell exempts tab-switch navigations from focus-on-route-change.
 *
 * AppShell owns focus-on-route-change (AC-ADMIA-004/005): every pathname change
 * moves focus to <main>. Record pages encode the active tab in the URL, so an
 * arrow-key tab switch is also a pathname change — and used to yank focus out of
 * the tab bar (WCAG 2.4.3). Navigations marked `pmoTabSwitch` (see
 * `src/lib/tabSwitchNav.ts`) are in-page tab switches: focus must stay put (the
 * Tabs roving-focus handler already moved it to the activated tab). Every other
 * pathname change still moves focus to <main>.
 *
 * Owning layer: Vitest/RTL — the focus stealer lives here (AppShell).
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import React from 'react';
import { AppShell } from '../AppShell';
import { withTabSwitchNavState } from '@/src/lib/tabSwitchNav';

describe('#879 AppShell route-focus exemption for tab switches', () => {
  it('AC #879: a pmoTabSwitch-marked navigation does NOT move focus to main — focus stays on the tab', () => {
    const TabSwitchProbe = () => {
      const navigate = useNavigate();
      return (
        <button
          type="button"
          onClick={() =>
            navigate('/projects/p1/budget', {
              replace: true,
              state: withTabSwitchNavState(undefined),
            })
          }
        >
          switch-tab
        </button>
      );
    };
    const tree = render(
      <MemoryRouter initialEntries={['/projects/p1/overview']}>
        <AppShell rail={null} header={null}>
          <div>x</div>
        </AppShell>
        <TabSwitchProbe />
      </MemoryRouter>,
    );
    const main = screen.getByRole('main');
    const tab = screen.getByRole('button', { name: 'switch-tab' });
    const scrollTo = vi.fn();
    Object.defineProperty(main, 'scrollTo', { configurable: true, value: scrollTo });
    tab.focus();
    expect(tab).toHaveFocus();
    expect(main).not.toHaveFocus();

    fireEvent.click(tab);

    // Real navigation did happen (pathname changed)…
    expect(main).toBeInTheDocument();
    // …but focus was NOT yanked to main: it stays in the tab bar.
    expect(tab).toHaveFocus();
    expect(main).not.toHaveFocus();
    expect(scrollTo).not.toHaveBeenCalled();
    tree.unmount();
  });

  it('keeps search focus when list-return state is cleared by typing, but focuses main on a pathname change', () => {
    const SearchProbe = () => {
      const navigate = useNavigate();
      return (
        <>
          <input aria-label="Search companies" onChange={() => navigate('/companies', { replace: true })} />
          <button type="button" onClick={() => navigate('/projects')}>real-route</button>
        </>
      );
    };
    render(
      <MemoryRouter initialEntries={[{ pathname: '/companies', state: { listReturn: true, scrollRestore: 100 } }]}>
        <AppShell rail={null} header={null}><div>x</div></AppShell>
        <SearchProbe />
      </MemoryRouter>,
    );
    const input = screen.getByRole('textbox', { name: 'Search companies' });
    const main = screen.getByRole('main');
    input.focus();
    fireEvent.change(input, { target: { value: 'vendor' } });
    expect(input).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'real-route' }));
    expect(main).toHaveFocus();
  });

  it('AC #879: a search-param-only navigation (same pathname, e.g. Approvals scope switch) does NOT move focus to main', () => {
    // Approvals.selectScope does `setSearchParams(params, { replace: true })` — same
    // pathname, new search. That is NOT a route change: the route-focus effect must not
    // re-run (it never did pre-#879), or switching scopes would steal focus + scroll.
    const SearchProbe = () => {
      const navigate = useNavigate();
      return (
        <button
          type="button"
          onClick={() => navigate('/approvals?scope=timesheets', { replace: true })}
        >
          switch-scope
        </button>
      );
    };
    const tree = render(
      <MemoryRouter initialEntries={['/approvals']}>
        <AppShell rail={null} header={null}>
          <div>x</div>
        </AppShell>
        <SearchProbe />
      </MemoryRouter>,
    );
    const main = screen.getByRole('main');
    const btn = screen.getByRole('button', { name: 'switch-scope' });
    btn.focus();
    expect(btn).toHaveFocus();

    fireEvent.click(btn);

    expect(btn).toHaveFocus();
    expect(main).not.toHaveFocus();
    tree.unmount();
  });

  it('AC #879: a marked tab navigation to another record moves focus to main', () => {
    const NavProbe = () => {
      const navigate = useNavigate();
      return (
        <button
          type="button"
          onClick={() =>
            navigate('/projects/p2/overview', { state: withTabSwitchNavState(undefined) })
          }
        >
          another-record
        </button>
      );
    };
    render(
      <MemoryRouter initialEntries={['/projects/p1/overview']}>
        <AppShell rail={null} header={null}><div>x</div></AppShell>
        <NavProbe />
      </MemoryRouter>,
    );
    const main = screen.getByRole('main');
    fireEvent.click(screen.getByRole('button', { name: 'another-record' }));
    expect(main).toHaveFocus();
  });

  it('AC #879: browser Back to a marked record entry from elsewhere moves focus to main', () => {
    const NavProbe = () => {
      const navigate = useNavigate();
      return (
        <>
          <button
            type="button"
            onClick={() => navigate('/projects/p1/budget', { state: withTabSwitchNavState(undefined) })}
          >
            marked-tab
          </button>
          <button type="button" onClick={() => navigate('/companies')}>elsewhere</button>
          <button type="button" onClick={() => navigate(-1)}>back</button>
        </>
      );
    };
    render(
      <MemoryRouter initialEntries={['/projects/p1/overview']}>
        <AppShell rail={null} header={null}><div>x</div></AppShell>
        <NavProbe />
      </MemoryRouter>,
    );
    const main = screen.getByRole('main');
    fireEvent.click(screen.getByRole('button', { name: 'marked-tab' }));
    fireEvent.click(screen.getByRole('button', { name: 'elsewhere' }));
    const back = screen.getByRole('button', { name: 'back' });
    back.focus();
    fireEvent.click(back);
    expect(main).toHaveFocus();
  });

  it('AC #879: a navigation WITHOUT the marker still moves focus to main (real navigation unchanged)', () => {
    const NavProbe = () => {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate('/projects')}>
          real-nav
        </button>
      );
    };
    const tree = render(
      <MemoryRouter>
        <AppShell rail={null} header={null}>
          <div>x</div>
        </AppShell>
        <NavProbe />
      </MemoryRouter>,
    );
    const main = screen.getByRole('main');
    const btn = screen.getByRole('button', { name: 'real-nav' });
    btn.focus();

    fireEvent.click(btn);

    expect(main).toHaveFocus();
    tree.unmount();
  });
});
