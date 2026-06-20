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
});
