import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatTiles, type StatTile } from '../StatTiles';

// ---------------------------------------------------------------------------
// StatTiles — the project-detail + procurement summary strip. UI-POLISH #5:
// on a narrow (375px) viewport a fixed `repeat(N,1fr)` grid clips money values
// mid-number. The strip must read as horizontally scrollable (peek + fade edge),
// not broken — while the equal-width grid is restored from `sm:` up.
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

  it('polish#5: the strip is a horizontal-scroll region on narrow viewports (scroll affordance)', () => {
    const { container } = render(<StatTiles tiles={tiles} columns={5} />);
    const strip = container.querySelector('[data-testid="stat-tiles"]') as HTMLElement;
    expect(strip).toBeInTheDocument();
    // It scrolls horizontally rather than crushing tiles below a legible width…
    expect(strip.className).toContain('overflow-x-auto');
    // …and restores the equal-width grid from the `sm:` breakpoint up.
    expect(strip.className).toContain('sm:overflow-visible');
  });

  it('polish#5: tiles have a minimum legible width so figures never clip mid-number', () => {
    const { container } = render(<StatTiles tiles={tiles} columns={5} />);
    const firstTile = container.querySelector('[data-testid="stat-tile"]') as HTMLElement;
    expect(firstTile).toBeInTheDocument();
    // A floored width on mobile (peek shows the next tile, signalling more to scroll).
    expect(firstTile.className).toMatch(/min-w-\[/);
    // The width floor is released at `sm:` so the equal grid takes over.
    expect(firstTile.className).toContain('sm:min-w-0');
  });

  it('still respects the columns prop for the grid layout', () => {
    const { container } = render(<StatTiles tiles={tiles} columns={4} />);
    const strip = container.querySelector('[data-testid="stat-tiles"]') as HTMLElement;
    expect(strip.style.gridTemplateColumns).toContain('repeat(4');
  });
});
