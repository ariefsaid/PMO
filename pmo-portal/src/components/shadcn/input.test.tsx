import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Input } from './input';

describe('shadcn Input', () => {
  it('uses the shared compact control height token', () => {
    render(<Input aria-label="Filter editor" />);

    expect(screen.getByRole('textbox', { name: 'Filter editor' })).toHaveClass('h-[var(--control-height-sm)]');
  });
});
