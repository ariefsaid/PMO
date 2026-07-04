import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '../Button';

afterEach(() => vi.restoreAllMocks());

describe('Button', () => {
  it('renders the primary variant token classes by default', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn.className).toContain('bg-primary');
    expect(btn.className).toContain('text-primary-foreground');
  });

  it('renders each variant with its token background', () => {
    const { rerender } = render(<Button variant="outline">x</Button>);
    expect(screen.getByRole('button').className).toContain('border-input');
    rerender(<Button variant="ghost">x</Button>);
    expect(screen.getByRole('button').className).toContain('hover:bg-accent');
    rerender(<Button variant="destructive">x</Button>);
    expect(screen.getByRole('button').className).toContain('bg-destructive');
  });

  /**
   * C2 (CRITICAL): outline variant must NOT carry `border-transparent` anywhere
   * in its resolved className — that class overrides `border-input` in Tailwind v4
   * (equal specificity, source order wins) and makes the border invisible.
   */
  it('C2: outline variant does not carry border-transparent (would eclipse border-input)', () => {
    render(<Button variant="outline">Outline</Button>);
    const btn = screen.getByRole('button', { name: 'Outline' });
    expect(btn.className).toContain('border-input');
    expect(btn.className).not.toContain('border-transparent');
  });

  it('renders the sm size class', () => {
    render(<Button size="sm">x</Button>);
    expect(screen.getByRole('button').className).toContain('h-7');
  });

  it('disabled is non-interactive and carries the disabled affordance', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        x
      </Button>
    );
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn.className).toContain('disabled:cursor-not-allowed');
    expect(btn.className).toContain('disabled:bg-secondary');
    expect(btn.className).toContain('disabled:text-secondary-foreground');
    expect(btn.className).toContain('disabled:border-border');
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('loading shows a spinner, sets aria-busy, and is disabled', () => {
    render(<Button loading>Save</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toBeDisabled();
    expect(screen.getByTestId('button-spinner')).toBeInTheDocument();
  });

  it('icon-only without an aria-label warns in the console', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<Button iconOnly>{undefined}</Button>);
    expect(warn).toHaveBeenCalled();
  });

  it('icon-only with aria-label does not warn and exposes the label', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<Button iconOnly aria-label="Refresh" />);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(warn).not.toHaveBeenCalled();
  });
});
