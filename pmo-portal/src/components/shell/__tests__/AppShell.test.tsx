import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { useReturnNavigate } from '@/src/hooks/useListReturn';
import React from 'react';
import { AppShell } from '../AppShell';
import { Breadcrumb } from '../Breadcrumb';
import { breadcrumbForPath } from '../routeMatch';
import { contextualListReturnNavigation } from '@/src/lib/listReturnContext';

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('AppShell', () => {
  it('renders the grid areas (rail/header/main slots)', () => {
    wrap(
      <AppShell
        rail={<div data-testid="rail-slot" />}
        header={<div data-testid="header-slot" />}
      >
        <div>page content</div>
      </AppShell>
    );
    expect(screen.getByTestId('rail-slot')).toBeInTheDocument();
    expect(screen.getByTestId('header-slot')).toBeInTheDocument();
    expect(screen.getByText('page content')).toBeInTheDocument();
  });

  it('main is a programmatically-focusable landmark with id=main', () => {
    wrap(
      <AppShell rail={null} header={null}>
        <div>x</div>
      </AppShell>
    );
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main');
    expect(main).toHaveAttribute('tabindex', '-1');
  });

  // AC-ADMIA-004/005 — focus-on-route-change is owned by AppShell (it renders <main> and moves
  // focus there on every pathname change, skipping the first mount). The Administration shell
  // relies on it to land keyboard/screen-reader users on the selected panel's heading, so this
  // behavior is asserted at its owning layer (Task 8 directive: test focus checks where they live).
  it('route change moves focus to main (focus-on-route-change), but never on first mount', () => {
    const NavProbe = () => {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate('/second-route')}>
          go
        </button>
      );
    };
    const tree = render(
      <MemoryRouter>
        <AppShell rail={null} header={null}>
          <div>x</div>
        </AppShell>
        <NavProbe />
      </MemoryRouter>
    );
    const main = screen.getByRole('main');
    // First mount is intentionally skipped (no focus yank on load).
    expect(main).not.toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'go' }));
    // A route change moves focus to the main landmark.
    expect(main).toHaveFocus();
    tree.unmount();
  });

  it('resets the main scroll container when the pathname changes', () => {
    const NavProbe = () => {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate('/second-route')}>
          go
        </button>
      );
    };
    render(
      <MemoryRouter>
        <AppShell rail={null} header={null}>
          <div>x</div>
        </AppShell>
        <NavProbe />
      </MemoryRouter>,
    );
    const main = screen.getByRole('main');
    main.scrollTop = 240;
    const scrollTo = vi.fn((options?: ScrollToOptions) => {
      const { top } = options ?? {};
      main.scrollTop = top ?? 0;
    });
    main.scrollTo = scrollTo as unknown as typeof main.scrollTo;

    fireEvent.click(screen.getByRole('button', { name: 'go' }));

    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
    expect(main.scrollTop).toBe(0);
  });

  it('renders a skip-to-main link', () => {
    wrap(
      <AppShell rail={null} header={null}>
        <div>x</div>
      </AppShell>
    );
    const skip = screen.getByRole('link', { name: /skip to main content/i });
    expect(skip).toHaveAttribute('href', '#main');
  });

  // AC-NAV-001 — the tab layer is fully removed. No browser-style workspace
  // tab strip should exist anywhere in the shell.
  it('AC-NAV-001: renders no workspace tab strip (no tablist, no gridArea:tabstrip)', () => {
    const { container } = wrap(
      <AppShell
        rail={<div data-testid="rail-slot">nav</div>}
        header={<div data-testid="header-slot">bar</div>}
      >
        <div>x</div>
      </AppShell>
    );
    // No element claims the "Open workspace tabs" tablist role.
    expect(
      screen.queryByRole('tablist', { name: /open workspace tabs/i })
    ).not.toBeInTheDocument();
    // No element occupies the removed `tabstrip` grid area.
    const tabstripArea = Array.from(container.querySelectorAll<HTMLElement>('*')).find(
      (el) => el.style.gridArea === 'tabstrip'
    );
    expect(tabstripArea).toBeUndefined();
  });

  // AC-NAV-002 — the grid drops from 3 rows to 2 (header + main) with the
  // two-area template; the rail spans both rows.
  it('AC-NAV-002: grid has exactly two rows and the rail/header/main areas', () => {
    const { container } = wrap(
      <AppShell rail={<div>nav</div>} header={<div>bar</div>}>
        <div>x</div>
      </AppShell>
    );
    const grid = container.querySelector<HTMLElement>('.grid');
    expect(grid).not.toBeNull();
    expect(grid!.style.gridTemplateRows).toBe('var(--header-h) 1fr');
    expect(grid!.style.gridTemplateAreas).toBe('"rail header" "rail main"');
  });

  // C1-a/c regression — the persistent grid-area rail is hidden ≤920px by the
  // SAME index.css media query that zeroes --rail-w (single source of truth),
  // via a .rail-persistent class. The hide must live on the grid-area wrapper,
  // NOT on the Rail <aside> itself (that would also blank the drawer copy).
  it('wraps the persistent grid-area rail in a .rail-persistent container', () => {
    const { container } = wrap(
      <AppShell rail={<div data-testid="rail-slot">nav</div>} header={null}>
        <div>x</div>
      </AppShell>
    );
    const persistent = container.querySelector('.rail-persistent');
    expect(persistent).not.toBeNull();
    // The persistent wrapper occupies the rail grid area and contains the rail.
    expect(persistent).toHaveStyle({ gridArea: 'rail' });
    expect(persistent?.querySelector('[data-testid="rail-slot"]')).not.toBeNull();
  });

  // C1-b regression — when the mobile drawer is open the SAME rail node renders
  // again inside the overlay, and that copy is NOT wrapped in .rail-persistent,
  // so the ≤920px hide never touches it: the drawer always shows nav.
  it('renders the rail inside the open mobile drawer WITHOUT the persistent hide', () => {
    const { container } = wrap(
      <AppShell rail={<div data-testid="rail-slot">nav</div>} header={null} railOpen>
        <div>x</div>
      </AppShell>
    );
    // Two rail copies render: one in the grid area, one in the drawer.
    expect(screen.getAllByTestId('rail-slot')).toHaveLength(2);
    // The drawer panel exists and holds a rail copy that is not under .rail-persistent.
    const drawerRails = Array.from(
      container.querySelectorAll('[data-testid="rail-slot"]')
    ).filter((el) => !el.closest('.rail-persistent'));
    expect(drawerRails.length).toBe(1);
  });

  // AC-AP-001 — when no assistant prop is passed (flag off), no complementary
  // landmark with the "Agent assistant" label should be rendered.
  it('AC-AP-001 flag off → no assistant slot rendered', () => {
    wrap(
      <AppShell rail={null} header={null}>
        <div>x</div>
      </AppShell>
    );
    expect(
      screen.queryByRole('complementary', { name: /agent assistant/i })
    ).not.toBeInTheDocument();
  });

  // AC-AP-002 — when an assistant node is passed (flag on), it is rendered as
  // a sibling of <main> (NOT inside <main>), and is inert when closed.
  it('AC-AP-002 flag on → assistant slot rendered as sibling of main, inert when closed', () => {
    wrap(
      <AppShell
        rail={null}
        header={null}
        assistantOpen={false}
        assistant={
          <aside
            role="complementary"
            aria-label="Agent assistant"
            inert
            data-testid="asst"
          />
        }
      >
        <div>x</div>
      </AppShell>
    );
    const asst = screen.getByTestId('asst');
    expect(asst).toBeInTheDocument();
    // Must NOT be inside <main>
    const main = screen.getByRole('main');
    expect(main.contains(asst)).toBe(false);
    // Must have the inert attribute (closed state)
    expect(asst).toHaveAttribute('inert');
  });

  it('AC-AXP-019 dock/overlay reflow + persists: docked open assistant reserves a shell column', () => {
    localStorage.setItem('pmo.agentPanel.mode', 'docked');
    localStorage.setItem('pmo.agentPanel.width', '512');

    const { container } = wrap(
      <AppShell
        rail={<div>nav</div>}
        header={<div>bar</div>}
        assistantOpen
        assistant={
          <aside
            role="complementary"
            aria-label="Agent assistant"
            data-testid="asst"
          />
        }
      >
        <div>x</div>
      </AppShell>
    );

    const grid = container.querySelector<HTMLElement>('.grid');
    expect(grid).not.toBeNull();
    expect(grid!.style.gridTemplateColumns).toBe(
      'var(--rail-w) minmax(0, 1fr) 512px'
    );
    expect(grid!.style.gridTemplateAreas).toBe(
      '"rail header assistant" "rail main assistant"'
    );

    const assistantSlot = screen.getByTestId('asst').parentElement;
    expect(assistantSlot).toHaveAttribute('data-assistant-dock-slot', 'true');
    expect(assistantSlot).toHaveStyle({ gridArea: 'assistant' });
  });

  it('AC-AXP-019 dock/overlay reflow + persists: overlay or closed assistant does not add a shell column', () => {
    localStorage.setItem('pmo.agentPanel.mode', 'overlay');
    localStorage.setItem('pmo.agentPanel.width', '512');

    const { container, rerender } = wrap(
      <AppShell
        rail={<div>nav</div>}
        header={<div>bar</div>}
        assistantOpen
        assistant={<aside role="complementary" aria-label="Agent assistant" />}
      >
        <div>x</div>
      </AppShell>
    );

    const grid = container.querySelector<HTMLElement>('.grid');
    expect(grid).not.toBeNull();
    expect(grid!.style.gridTemplateColumns).toBe('var(--rail-w) minmax(0, 1fr)');
    expect(grid!.style.gridTemplateAreas).toBe('"rail header" "rail main"');

    localStorage.setItem('pmo.agentPanel.mode', 'docked');
    rerender(
      <MemoryRouter>
        <AppShell
          rail={<div>nav</div>}
          header={<div>bar</div>}
          assistantOpen={false}
          assistant={<aside role="complementary" aria-label="Agent assistant" />}
        >
          <div>x</div>
        </AppShell>
      </MemoryRouter>
    );

    expect(grid!.style.gridTemplateColumns).toBe('var(--rail-w) minmax(0, 1fr)');
    expect(grid!.style.gridTemplateAreas).toBe('"rail header" "rail main"');
  });

  it('AC-AXP-019 dock/overlay reflow + persists: shell reacts when panel prefs change', () => {
    localStorage.setItem('pmo.agentPanel.mode', 'overlay');
    localStorage.setItem('pmo.agentPanel.width', '400');

    const { container } = wrap(
      <AppShell
        rail={<div>nav</div>}
        header={<div>bar</div>}
        assistantOpen
        assistant={<aside role="complementary" aria-label="Agent assistant" />}
      >
        <div>x</div>
      </AppShell>
    );

    const grid = container.querySelector<HTMLElement>('.grid');
    expect(grid).not.toBeNull();
    expect(grid!.style.gridTemplateColumns).toBe('var(--rail-w) minmax(0, 1fr)');

    localStorage.setItem('pmo.agentPanel.mode', 'docked');
    localStorage.setItem('pmo.agentPanel.width', '544');
    act(() => {
      window.dispatchEvent(new Event('pmo.agentPanel.prefsChanged'));
    });

    expect(grid!.style.gridTemplateColumns).toBe(
      'var(--rail-w) minmax(0, 1fr) 544px'
    );
  });
});

// ── Desktop parent-breadcrumb return seam (FR-LRC-004/005/006, AC-LRC-010) ──────────
// Proves the rendered shell breadcrumb carries the shared return navigation: a valid context
// navigates to the captured list URL with one-shot scroll-restore state and no pmoListReturn; a
// tampered context falls back to the owning index with neither seam key.
describe('AppShell — parent breadcrumb record return', () => {
  function LocationProbe() {
    const location = useLocation();
    return (
      <output
        data-testid="loc"
        data-path={`${location.pathname}${location.search}`}
        data-state={JSON.stringify(location.state ?? null)}
      />
    );
  }

  function DetailBreadcrumbShell({ pathname, state }: { pathname: string; state: unknown }) {
    // The real adapter App.tsx wires into the breadcrumb (not a test-local rebuild).
    const breadcrumbNavigate = useReturnNavigate();
    const contextual = contextualListReturnNavigation(pathname, state);
    const parts = breadcrumbForPath(
      pathname,
      'Harbor Co',
      breadcrumbNavigate,
      true,
      undefined,
      contextual,
    );
    return (
      <AppShell
        rail={null}
        header={
          <Breadcrumb
            parts={parts}
          />
        }
      >
        <div>detail</div>
      </AppShell>
    );
  }

  function renderDetailBreadcrumb(pathname: string, state: unknown) {
    return render(
      <MemoryRouter initialEntries={[{ pathname, state }]}>
        <DetailBreadcrumbShell pathname={pathname} state={state} />
        <LocationProbe />
      </MemoryRouter>,
    );
  }

  it('FR-LRC-005: a valid return context navigates with the one-shot restore state and no pmoListReturn', () => {
    renderDetailBreadcrumb('/companies/company-1', {
      pmoListReturn: {
        list: 'companies',
        path: '/companies?type=Client&q=harbor',
        scrollTop: 240,
        sourceLocationKey: 'e1',
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Companies' }));

    const loc = screen.getByTestId('loc');
    expect(loc).toHaveAttribute('data-path', '/companies?type=Client&q=harbor');
    const state = JSON.parse(loc.getAttribute('data-state') ?? '{}');
    expect(state.pmoListScrollRestore).toEqual({
      list: 'companies',
      path: '/companies?type=Client&q=harbor',
      scrollTop: 240,
    });
    expect(state.pmoListReturn).toBeUndefined();
  });

  it('AC-LRC-010: a tampered return path falls back to the owning index with neither seam key', () => {
    renderDetailBreadcrumb('/companies/company-1', {
      pmoListReturn: { list: 'companies', path: '/contacts?company=evil' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Companies' }));

    const loc = screen.getByTestId('loc');
    expect(loc).toHaveAttribute('data-path', '/companies');
    const state = JSON.parse(loc.getAttribute('data-state') ?? '{}');
    expect(state.pmoListScrollRestore).toBeUndefined();
    expect(state.pmoListReturn).toBeUndefined();
  });

  it('FR-LRC-006: a project opened from Sales keeps its Projects crumb pointing at /projects', () => {
    renderDetailBreadcrumb('/projects/project-1', {
      pmoListReturn: {
        list: 'sales',
        path: '/sales?scope=Needs+attention&status=Leads&view=table',
        scrollTop: 180,
        sourceLocationKey: 's1',
      },
    });

    expect(screen.queryByRole('button', { name: 'Sales Pipeline' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));

    const loc = screen.getByTestId('loc');
    expect(loc).toHaveAttribute('data-path', '/projects');
    const state = JSON.parse(loc.getAttribute('data-state') ?? '{}');
    expect(state.pmoListScrollRestore).toBeUndefined();
    expect(state.pmoListReturn).toBeUndefined();
  });
});
