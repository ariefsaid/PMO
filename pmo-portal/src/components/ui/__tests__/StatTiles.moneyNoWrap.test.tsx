import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatTiles } from '../StatTiles';

// Rule 15 (P0): a money figure never wraps. On a 390px phone a one-million budget read as one thousand
// because "US$1.000.000" broke after "US$1.000.00". jsdom has no layout, so the test binds the two classes
// that decide it: the figure is nowrap, and the strip is ONE column until its container fits two tiles.
const LONGEST = ['Rp 999.999.999.999,00', 'US$1.000.000,00', 'US$ 1,000,000.00'];

describe('Rule 15: a money figure never wraps (390 width)', () => {
  it.each(LONGEST)('keeps %s on one line and gives it a full-width cell on a phone', (figure) => {
    render(<StatTiles variant="bare" columns={5} tiles={[
      { label: 'Not yet committed', value: figure },
      { label: 'Project budget', value: figure },
      { label: 'After this procurement', value: figure, sub: '12% headroom left' },
    ]} />);
    const value = screen.getAllByText(figure)[0];
    const cell = value.closest('div') as HTMLElement;
    expect(cell.className).toContain('whitespace-nowrap');
    expect(cell.className).not.toContain('break-words');
    const strip = screen.getByTestId('stat-tiles');
    expect(strip.className).toMatch(/(^|\s)grid-cols-1(\s|$)/);
    expect(strip.className).not.toMatch(/(^|\s)grid-cols-2(\s|$)/);
  });
});
