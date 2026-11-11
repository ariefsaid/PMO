import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Avatar } from './userPresentation';

/**
 * The directory avatar tile is a FIXED 30px (the single size the Users directory row is built
 * around) — pinned here so a layout-dependent dimension change is a deliberate, visible one.
 */
describe('Avatar (Administration › Users directory tile)', () => {
  it('renders initials at the fixed 30px tile size', () => {
    const { container } = render(<Avatar user={{ id: 'u1', full_name: 'Renata Halloway' }} />);
    const tile = container.firstElementChild as HTMLElement;
    expect(tile.style.width).toBe('30px');
    expect(tile.style.height).toBe('30px');
    expect(tile.textContent).toBe('RH');
  });
});
