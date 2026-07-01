/**
 * ThemeToggle — F2 dark-mode toggle button.
 *
 * Asserts the a11y contract: the icon button's aria-label describes the ACTION
 * it will perform, reflecting the CURRENT theme state (so a screen-reader user
 * knows what clicking does). The icon is decorative (the label carries meaning).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeToggle } from '../ThemeToggle';

describe('ThemeToggle (F2)', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark');
    localStorage.removeItem('theme');
  });

  it('(c) in light mode the button advertises the action "Switch to dark theme"', () => {
    render(<ThemeToggle />);
    const btn = screen.getByRole('button', { name: /switch to dark theme/i });
    expect(btn).toBeInTheDocument();
  });

  it('(c) in dark mode the button advertises the action "Switch to light theme"', () => {
    document.documentElement.classList.add('dark');
    render(<ThemeToggle />);
    expect(
      screen.getByRole('button', { name: /switch to light theme/i }),
    ).toBeInTheDocument();
  });

  it('clicking the button flips the `dark` class on documentElement + persists', async () => {
    render(<ThemeToggle />);
    const btn = screen.getByRole('button', { name: /switch to dark theme/i });
    await userEvent.click(btn);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('theme')).toBe('dark');
    // Label now reflects the new state.
    expect(
      screen.getByRole('button', { name: /switch to light theme/i }),
    ).toBeInTheDocument();
  });

  it('is keyboard-focusable (a top-bar control in the tab order)', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: /switch to dark theme/i })).toHaveAttribute(
      'type',
      'button',
    );
  });
});
