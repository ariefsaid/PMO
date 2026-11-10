import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar } from '../Avatar';

describe('Avatar', () => {
  it('shows neutral initials from the name when there is no photo', () => {
    render(<Avatar name="Rina Kartika" />);
    const el = screen.getByRole('img', { name: 'Rina Kartika' });
    expect(el).toHaveTextContent('RK');
    expect(el.className).toContain('bg-secondary');
  });

  it('is hidden from assistive tech when decorative', () => {
    const { container } = render(<Avatar name="Rina Kartika" decorative />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('uses an explicit initials override and the fallback marker for a blank name', () => {
    const { rerender } = render(<Avatar name="Finance" initials="FI" />);
    expect(screen.getByRole('img')).toHaveTextContent('FI');
    rerender(<Avatar name="" />);
    expect(screen.getByRole('img')).toHaveTextContent('?');
  });
});
