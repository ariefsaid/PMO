import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { AppShell } from '../AppShell';

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
    const { container } = wrap(
      <AppShell
        rail={null}
        header={null}
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
});
