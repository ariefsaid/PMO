/**
 * AC-PRJUX-001 / AC-PRJUX-006 — ListPage single-render responsive seam.
 *
 * When a `mobileToolbar` is supplied and the viewport is below `md`, ListPage renders
 * the mobile node as the SOLE `list-page-toolbar` (the desktop slots are absent). At
 * `md`+ the canonical desktop slots render in their fixed order. A ListPage WITHOUT a
 * `mobileToolbar` keeps the existing desktop behavior in every viewport. The header
 * primary action lives in both variants.
 *
 * Tests use structural test IDs only; user-facing controls are role/name-asserted in the
 * Projects tests.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { ListPage } from '../ListPage';

const viewport = { isDesktop: true };
function mockViewport(isDesktop: boolean) {
  viewport.isDesktop = isDesktop;
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: isDesktop,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}
afterEach(() => vi.unstubAllGlobals());

const desktopSlots = [
  'slot-filters',
  'slot-search',
  'slot-secondary',
  'slot-export',
  'slot-import',
  'slot-view',
];

const renderWithMobile = (mobileToolbar: React.ReactNode) =>
  render(
    <ListPage
      title="Projects"
      primaryAction={<button type="button">New project</button>}
      mobileToolbar={mobileToolbar}
      view={<div data-testid="slot-view">view</div>}
      filters={<div data-testid="slot-filters">filters</div>}
      search={<div data-testid="slot-search">search</div>}
      secondaryFilter={<div data-testid="slot-secondary">secondary</div>}
      exportAction={<div data-testid="slot-export">export</div>}
      importAction={<div data-testid="slot-import">import</div>}
    >
      body
    </ListPage>,
  );

describe('ListPage mobile toolbar seam (AC-PRJUX-001 / AC-PRJUX-006)', () => {
  it('AC-PRJUX-001: below md the mobile node is the sole toolbar — desktop slots are absent', () => {
    mockViewport(false);
    renderWithMobile(<div data-testid="mobile-toolbar-node">mobile</div>);
    const toolbar = screen.getByTestId('list-page-toolbar');
    expect(within(toolbar).getByTestId('mobile-toolbar-node')).toBeInTheDocument();
    for (const id of desktopSlots) {
      expect(within(toolbar).queryByTestId(id)).not.toBeInTheDocument();
    }
    // header primary action survives the switch
    expect(screen.getByRole('button', { name: 'New project' })).toBeInTheDocument();
  });

  it('AC-PRJUX-006: at md+ the canonical desktop slots render in fixed order, mobile node absent', () => {
    mockViewport(true);
    renderWithMobile(<div data-testid="mobile-toolbar-node">mobile</div>);
    const toolbar = screen.getByTestId('list-page-toolbar');
    expect(within(toolbar).queryByTestId('mobile-toolbar-node')).not.toBeInTheDocument();
    const ids = within(toolbar)
      .getAllByTestId(/^slot-/)
      .map((el) => el.getAttribute('data-testid'));
    expect(ids).toEqual(desktopSlots);
    expect(screen.getByRole('button', { name: 'New project' })).toBeInTheDocument();
  });

  it('AC-PRJUX-006: without mobileToolbar the desktop toolbar behavior is preserved even below md', () => {
    mockViewport(false);
    render(
      <ListPage
        title="Companies"
        primaryAction={<button type="button">New</button>}
        filters={<div data-testid="slot-filters">filters</div>}
        search={<div data-testid="slot-search">search</div>}
        view={<div data-testid="slot-view">view</div>}
      >
        body
      </ListPage>,
    );
    const toolbar = screen.getByTestId('list-page-toolbar');
    expect(within(toolbar).getByTestId('slot-filters')).toBeInTheDocument();
    expect(within(toolbar).getByTestId('slot-search')).toBeInTheDocument();
    expect(within(toolbar).getByTestId('slot-view')).toBeInTheDocument();
  });

  it('AC-PRJUX-006: mobileToolbar alone (no desktop slots) still renders a toolbar below md', () => {
    mockViewport(false);
    render(
      <ListPage title="Projects" mobileToolbar={<div data-testid="mobile-toolbar-node">m</div>}>
        body
      </ListPage>,
    );
    const toolbar = screen.getByTestId('list-page-toolbar');
    expect(within(toolbar).getByTestId('mobile-toolbar-node')).toBeInTheDocument();
  });
});