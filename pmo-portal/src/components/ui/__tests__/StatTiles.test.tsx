import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatTiles, type StatTile } from '../StatTiles';

// ---------------------------------------------------------------------------
// StatTiles — the project-detail + procurement summary strip.
//
// I6 (design-review fix): on mobile the strip MUST be a 2-col grid so all KPIs
// are visible at a glance — the previous horizontal-scroll carousel pushed KPIs
// off-screen. Desktop and tablet behavior is unchanged (equal-width grid via
// gridTemplateColumns). No snap/overflow-x-auto on mobile.
//
// AC-METRIC-TILE-CLIP-001 (metric-tile-clip-mobile fix): when tile count is odd,
// the last tile spans the full 2-col width on mobile (col-span-2) so the bottom
// row is never a half-empty visual "clipped" cell. sm:col-span-1 resets at tablet+.
// ---------------------------------------------------------------------------

const tiles: StatTile[] = [
  { label: 'Contract', value: '$5,000,000' },
  { label: 'Committed', value: '$3,200,000' },
  { label: 'Actual', value: '$1,750,000' },
  { label: 'On-hand margin', value: '$3,250,000', tone: 'pos' },
  { label: 'Spend', value: '64%' },
];

describe('StatTiles', () => {
  it('renders every tile (label + value)', () => {
    render(<StatTiles tiles={tiles} columns={5} />);
    expect(screen.getByText('Contract')).toBeInTheDocument();
    expect(screen.getByText('$5,000,000')).toBeInTheDocument();
    expect(screen.getByText('Spend')).toBeInTheDocument();
  });

  it('I6: the strip renders a 2-col grid on mobile (no horizontal carousel)', () => {
    const { container } = render(<StatTiles tiles={tiles} columns={5} />);
    const strip = container.querySelector('[data-testid="stat-tiles"]') as HTMLElement;
    expect(strip).toBeInTheDocument();
    // Must be a 2-col grid on mobile — no overflow-x-auto carousel
    expect(strip.className).toContain('grid-cols-2');
    expect(strip.className).not.toContain('overflow-x-auto');
    expect(strip.className).not.toContain('snap-mandatory');
  });

  it('I6: tile items do NOT carry snap-start or basis-[44%] carousel affordances', () => {
    const { container } = render(<StatTiles tiles={tiles} columns={5} />);
    const firstTile = container.querySelector('[data-testid="stat-tile"]') as HTMLElement;
    expect(firstTile).toBeInTheDocument();
    expect(firstTile.className).not.toContain('snap-start');
    expect(firstTile.className).not.toContain('basis-[44%]');
  });

  it('I6: no horizontal overflow (overflow-x-auto) on the strip — all tiles are in-view', () => {
    const { container } = render(<StatTiles tiles={tiles} columns={5} />);
    const strip = container.querySelector('[data-testid="stat-tiles"]') as HTMLElement;
    expect(strip.className).not.toContain('overflow-x-auto');
  });

  it('respects the columns prop for the sm+ grid layout (sm:grid-cols-{n} class)', () => {
    const { container } = render(<StatTiles tiles={tiles} columns={4} />);
    const strip = container.querySelector('[data-testid="stat-tiles"]') as HTMLElement;
    // The sm:grid-cols-4 class drives the equal-width grid at tablet/desktop
    expect(strip.className).toContain('sm:grid-cols-4');
  });

  it('renders a tile sub-text when provided', () => {
    const tilesWithSub: StatTile[] = [
      { label: 'PR value', value: '$85,000', sub: 'Review Project' },
    ];
    render(<StatTiles tiles={tilesWithSub} />);
    expect(screen.getByText('Review Project')).toBeInTheDocument();
  });

  // ── AC-METRIC-TILE-CLIP-001: odd-count tile sets ─────────────────────────
  // Given: a StatTiles strip with an odd number of tiles (5 or 3)
  // When: rendered in a 2-col mobile grid
  // Then: the last tile spans both columns (col-span-2) so the bottom row is
  //       never a half-empty visual "clipped" cell; sm:col-span-1 resets at sm+.

  it('AC-METRIC-TILE-CLIP-001: odd tile count (5) — last tile has col-span-2 + sm:col-span-1', () => {
    const { container } = render(<StatTiles tiles={tiles} columns={5} />);
    const allTiles = container.querySelectorAll('[data-testid="stat-tile"]');
    expect(allTiles).toHaveLength(5);
    const lastTile = allTiles[allTiles.length - 1] as HTMLElement;
    // Must carry col-span-2 for mobile (fills the bottom row) + sm:col-span-1 reset
    expect(lastTile.className).toContain('col-span-2');
    expect(lastTile.className).toContain('sm:col-span-1');
  });

  it('AC-METRIC-TILE-CLIP-001: even tile count (4) — no tile carries col-span-2', () => {
    const evenTiles: StatTile[] = [
      { label: 'A', value: '1' },
      { label: 'B', value: '2' },
      { label: 'C', value: '3' },
      { label: 'D', value: '4' },
    ];
    const { container } = render(<StatTiles tiles={evenTiles} columns={4} />);
    const allTiles = container.querySelectorAll('[data-testid="stat-tile"]');
    expect(allTiles).toHaveLength(4);
    allTiles.forEach((tile) => {
      expect((tile as HTMLElement).className).not.toContain('col-span-2');
    });
  });

  it('AC-METRIC-TILE-CLIP-001: odd tile count (3) — last tile spans full width on mobile', () => {
    const threeTiles: StatTile[] = [
      { label: 'This request', value: '$85,000' },
      { label: 'Reserved', value: '$20,000' },
      { label: 'Available', value: '$5,000' },
    ];
    const { container } = render(<StatTiles tiles={threeTiles} columns={3} />);
    const allTiles = container.querySelectorAll('[data-testid="stat-tile"]');
    expect(allTiles).toHaveLength(3);
    const lastTile = allTiles[allTiles.length - 1] as HTMLElement;
    expect(lastTile.className).toContain('col-span-2');
    expect(lastTile.className).toContain('sm:col-span-1');
  });

  // ── content-over-containers (monochrome-calm reskin, L2-RECORD) ──────────
  // The record page renders its finance strip BORDERLESS — the KPIs sit directly on
  // the canvas (label + value), separated by whitespace + a hairline, not a boxed
  // card-in-card. `variant="bare"` is the opt-in; default (`framed`) keeps the box.
  it('variant="bare": borderless strip on the canvas (no card frame, no cell fill)', () => {
    const { container } = render(<StatTiles tiles={tiles} columns={5} variant="bare" />);
    const strip = container.querySelector('[data-testid="stat-tiles"]') as HTMLElement;
    expect(strip).toBeInTheDocument();
    // No outer card frame — content-over-containers
    expect(strip.className).not.toContain('border-border');
    expect(strip.className).not.toContain('bg-border');
    expect(strip.className).not.toContain('rounded-lg');
    // Responsive layout preserved (mobile 2-col + sm:grid-cols-5)
    expect(strip.className).toContain('grid-cols-2');
    expect(strip.className).toContain('sm:grid-cols-5');
    // Cells are borderless too — no card fill, no end-cap rounding
    const firstCell = container.querySelector('[data-testid="stat-tile"]') as HTMLElement;
    expect(firstCell.className).not.toContain('bg-card');
    expect(firstCell.className).not.toContain('rounded-l-lg');
  });

  it('variant="bare": odd-count clip behavior is preserved (last tile spans mobile)', () => {
    const { container } = render(<StatTiles tiles={tiles} columns={5} variant="bare" />);
    const allTiles = container.querySelectorAll('[data-testid="stat-tile"]');
    const lastTile = allTiles[allTiles.length - 1] as HTMLElement;
    expect(lastTile.className).toContain('col-span-2');
    expect(lastTile.className).toContain('sm:col-span-1');
  });
});
