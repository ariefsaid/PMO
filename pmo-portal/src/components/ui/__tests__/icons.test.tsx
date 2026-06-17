/**
 * Icon has a default 1em size so classless usages never balloon (timesheet toolbar regression, 2026-06-14)
 *
 * Root cause: <svg> had no default width/height, so classless <Icon> rendered
 * at ~77px (SVG user-agent default). Fixed via presentational attributes
 * width="1em" height="1em" — a Tailwind class always wins over a presentation
 * attribute, so explicit className / width / height props cleanly override.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Icon } from '../icons';

describe('Icon', () => {
  it('AC-ICON-001: classless <Icon> renders with default width="1em" and height="1em" so it scales to surrounding text instead of ballooning', () => {
    render(<Icon name="plus" data-testid="icon" />);
    const svg = screen.getByTestId('icon');
    expect(svg).toHaveAttribute('width', '1em');
    expect(svg).toHaveAttribute('height', '1em');
  });

  it('AC-ICON-002: <Icon> with explicit className still carries the class (override path intact)', () => {
    render(<Icon name="plus" className="h-5 w-5" data-testid="icon" />);
    const svg = screen.getByTestId('icon');
    expect(svg).toHaveClass('h-5 w-5');
  });

  it('AC-ICON-003: explicit width prop overrides the default presentational attribute', () => {
    render(<Icon name="plus" width={20} data-testid="icon" />);
    const svg = screen.getByTestId('icon');
    // React sets numeric width as a string attribute
    expect(svg).toHaveAttribute('width', '20');
  });
});
