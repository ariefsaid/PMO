import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../StatusPill';

describe('DS spacing normalization (H3 scoped subset)', () => {
  it('AC-W6-H3: count Badge uses px-2 (not the arbitrary px-[7px])', () => {
    render(<Badge>4</Badge>);
    const b = screen.getByText('4');
    expect(b.className).toContain('px-2');
    expect(b.className).not.toContain('px-[7px]');
  });
});
