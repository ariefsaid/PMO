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
// row is never a half-empty visual "clipped" cell. The span reset applies once the N-col
// container layout activates (tidy sweep: container queries, not viewport breakpoints).
// ---------------------------------------------------------------------------

const tiles: StatTile[] = [
  { label: 'Contract', value: '$5,000,000' },
  { label: 'Committed', value: '$3,200,000' },
  { label: 'Actual', value: '$1,750,000' },
  { label: 'On-hand margin', value: '$3,250,000', tone: 'pos' },
  { label: 'Spend', value: '64%' },
];

describe('StatTiles', () => {
  it('AC-RD-MONEY-001: short figure visible; exact amount is the title and screen-reader text', () => {
    render(<StatTiles tiles={[{ label: 'Contract', value: '$1.2M', exactValue: '$1,200,000' }]} />);
    const figure = screen.getByText('$1.2M');
    expect(figure).toHaveAttribute('aria-hidden', 'true');
    expect(figure).toHaveAttribute('title', '$1,200,000');
    expect(screen.getByText('$1,200,000', { selector: '.sr-only' })).toBeInTheDocument();
  });

  it('AC-MONEY-DISPLAY: unknown stat omits the amount and shows the reason once', () => {
    render(<StatTiles tiles={[{ label: 'Contract', value: 'Unavailable', unavailableReason: 'Budget not loaded' }]} />);
    expect(screen.getByRole('status')).toHaveTextContent('Budget not loaded');
    expect(screen.queryByText('—')).not.toBeInTheDocument();
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Budget not loaded' })).not.toBeInTheDocument();
  });

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

  it('respects the columns prop for the wide-container grid layout (@3xl:grid-cols-4 class)', () => {
    const { container } = render(<StatTiles tiles={tiles} columns={4} />);
    const strip = container.querySelector('[data-testid="stat-tiles"]') as HTMLElement;
    // The @3xl:grid-cols-4 container class drives the equal-width grid once the strip's own
    // container fits four tiles (tidy sweep: container queries, not viewport sm:)
    expect(strip.className).toContain('@3xl:grid-cols-4');
    expect(strip.className).toContain('@container');
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
  //       never a half-empty visual "clipped" cell; the span reset applies once the N-col
  //       container layout activates.

  it('AC-METRIC-TILE-CLIP-001: odd tile count (5) — spans mobile rows, resets at the 5-col container', () => {
    const { container } = render(<StatTiles tiles={tiles} columns={5} />);
    const allTiles = container.querySelectorAll('[data-testid="stat-tile"]');
    expect(allTiles).toHaveLength(5);
    const lastTile = allTiles[allTiles.length - 1] as HTMLElement;
    // col-span-2 fills the mobile bottom row; the reset applies once the 5-col container
    // layout activates (@5xl), after the intermediate 3-col stage keeps it spanning.
    expect(lastTile.className).toContain('col-span-2');
    expect(lastTile.className).toContain('@5xl:col-span-1');
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
    expect(lastTile.className).toContain('@xl:col-span-1');
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
    // Responsive layout preserved (mobile 2-col + the 5-col container layout)
    expect(strip.className).toContain('grid-cols-2');
    expect(strip.className).toContain('@5xl:grid-cols-5');
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
    expect(lastTile.className).toContain('@5xl:col-span-1');
  });

  // Layout rule 15: a money figure renders on one line, always. The label wraps or the tile takes the whole
  // row; the number is never broken (phone, Bahasa: "US$1.000.0" / "00" read as a smaller budget).
  describe('layout rule 15: a money figure never wraps', () => {
    const wide = { label: 'Belum dikomitmenkan', value: 'US$1.000.000' };
    const short = { label: 'Total pengadaan', value: 'US$22.500' };

    it('the figure is one unbreakable line (nowrap, tabular), with a plain or an exact value', () => {
      render(<StatTiles tiles={[wide, { label: 'Exact', value: '$1.2M', exactValue: '$1,200,000' }]} />);
      for (const el of [screen.getByText('US$1.000.000'), screen.getByText('$1.2M')]) {
        expect(el.closest('.whitespace-nowrap')).not.toBeNull();
      }
      const box = screen.getByText('US$1.000.000').closest('.tabular') as HTMLElement;
      expect(box.className).not.toMatch(/break-(words|all)/);
    });

    it('a wide tile never keeps its span into the 3-col layout (a 2-wide tile beside an empty cell)', () => {
      render(<StatTiles tiles={[short, short, short, wide, short]} columns={5} />);
      const tile = screen.getAllByTestId('stat-tile')[3];
      expect(tile.className).toContain('@md:col-span-1');
      expect(tile.className).not.toContain('@5xl:col-span-1');
    });

    it('measured edge at a 155px phone tile: "US$210.000" overflows (wide), "$6,900,000" fits (not wide)', () => {
      const spans = (value: string) => {
        const { unmount } = render(<StatTiles tiles={[{ label: 'a', value: '$1' }, { label: 'b', value }, { label: 'c', value: '$2' }]} columns={4} />);
        const span = screen.getAllByTestId('stat-tile')[1].className.includes('col-span-2');
        unmount();
        return span;
      };
      expect(spans('US$210.000')).toBe(true);
      expect(spans('$6,900,000')).toBe(false);
    });

    it('an odd last tile that is wide keeps filling the N-col row (no gap beside it at desktop)', () => {
      render(<StatTiles tiles={[short, short, wide]} columns={3} />);
      const last = screen.getAllByTestId('stat-tile')[2];
      expect(last.className).toContain('col-span-2');
      expect(last.className).toContain('@xl:col-span-1');
      expect(last.className).not.toContain('@md:col-span-1');
    });

    it('a tile left alone before a wide tile takes its row too, so no row is half empty (phone)', () => {
      render(<StatTiles tiles={[short, short, short, wide]} columns={4} />);
      const [a, b, c, d] = screen.getAllByTestId('stat-tile');
      expect(a.className).not.toContain('col-span-2');
      expect(b.className).not.toContain('col-span-2');
      expect(c.className).toContain('col-span-2');
      expect(c.className).toContain('@md:col-span-1');
      expect(d.className).toContain('col-span-2');
    });

    it('a figure too long for half a phone row takes the whole row; the label stays above it and may wrap', () => {
      render(<StatTiles tiles={[short, short, wide, short]} columns={4} />);
      const [a, b, c, d] = screen.getAllByTestId('stat-tile');
      expect(a.className).not.toContain('col-span-2');
      expect(b.className).not.toContain('col-span-2');
      expect(c.className).toContain('col-span-2');
      // 2-up resumes as soon as the pane fits two figures abreast (@md), whatever the strip's column count
      expect(c.className).toContain('@md:col-span-1');
      expect(d.className).toContain('col-span-2'); // the tile left alone after it takes its row too
      // the label sits in its own block above the figure, so a long label wraps without touching the number
      const label = screen.getAllByText('Belum dikomitmenkan')[0];
      expect(label.className).not.toContain('whitespace-nowrap');
      expect(label.nextElementSibling?.className).toContain('whitespace-nowrap');
    });
  });

  describe('wideFigures (money in the billions)', () => {
    const tile = (n: number) => ({ label: `Tile ${n}`, value: 'Rp 12.685.600.000' });
    it('waits for a 52rem strip before going three across, so a figure never outgrows its tile', () => {
      render(<StatTiles tiles={[1, 2, 3, 4, 5, 6].map(tile)} columns={3} wideFigures />);
      const strip = screen.getByTestId('stat-tiles');
      expect(strip.className).toContain('@[52rem]:grid-cols-3');
      expect(strip.className).not.toContain('@xl:grid-cols-3');
    });
    it('keeps the normal threshold when the strip does not carry wide figures', () => {
      render(<StatTiles tiles={[1, 2, 3].map(tile)} columns={3} />);
      expect(screen.getByTestId('stat-tiles').className).toContain('@xl:grid-cols-3');
    });
  });
});
