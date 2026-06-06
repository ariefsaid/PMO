import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { AppShell } from '../AppShell';

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('AppShell', () => {
  it('renders the grid areas (rail/header/tabstrip/main slots)', () => {
    wrap(
      <AppShell
        rail={<div data-testid="rail-slot" />}
        header={<div data-testid="header-slot" />}
        tabstrip={<div data-testid="tabstrip-slot" />}
      >
        <div>page content</div>
      </AppShell>
    );
    expect(screen.getByTestId('rail-slot')).toBeInTheDocument();
    expect(screen.getByTestId('header-slot')).toBeInTheDocument();
    expect(screen.getByTestId('tabstrip-slot')).toBeInTheDocument();
    expect(screen.getByText('page content')).toBeInTheDocument();
  });

  it('main is a programmatically-focusable landmark with id=main', () => {
    wrap(
      <AppShell rail={null} header={null} tabstrip={null}>
        <div>x</div>
      </AppShell>
    );
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main');
    expect(main).toHaveAttribute('tabindex', '-1');
  });

  it('renders a skip-to-main link', () => {
    wrap(
      <AppShell rail={null} header={null} tabstrip={null}>
        <div>x</div>
      </AppShell>
    );
    const skip = screen.getByRole('link', { name: /skip to main content/i });
    expect(skip).toHaveAttribute('href', '#main');
  });

  // C1-a/c regression — the persistent grid-area rail is hidden ≤920px by the
  // SAME index.css media query that zeroes --rail-w (single source of truth),
  // via a .rail-persistent class. The hide must live on the grid-area wrapper,
  // NOT on the Rail <aside> itself (that would also blank the drawer copy).
  it('wraps the persistent grid-area rail in a .rail-persistent container', () => {
    const { container } = wrap(
      <AppShell
        rail={<div data-testid="rail-slot">nav</div>}
        header={null}
        tabstrip={null}
      >
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
      <AppShell
        rail={<div data-testid="rail-slot">nav</div>}
        header={null}
        tabstrip={null}
        railOpen
      >
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
});
