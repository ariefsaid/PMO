import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Card, CardHead, CardPad } from '../Card';

describe('Card', () => {
  it('static card has a border and NO rest shadow (Flat-By-Default)', () => {
    render(<Card>body</Card>);
    const card = screen.getByText('body');
    expect(card.className).toContain('border-border');
    expect(card.className).toContain('bg-card');
    expect(card.className).not.toMatch(/shadow-\[/);
  });

  it('interactive card gets the hover state-lift shadow', () => {
    render(<Card interactive>body</Card>);
    expect(screen.getByText('body').className).toContain('hover:shadow-[0_2px_10px_hsl(240_6%_10%/0.06)]');
  });

  it('seam variant squares the bottom corners (sits above a table)', () => {
    render(<Card seam>body</Card>);
    expect(screen.getByText('body').className).toContain('rounded-b-none');
  });

  it('CardHead renders a titled header with a bottom border and a navigable heading level', () => {
    render(<CardHead>Pipeline</CardHead>);
    // Default sits one level under the page h1 (no h1 -> h3 skip); explicit level for nested cards.
    const heading = screen.getByRole('heading', { name: 'Pipeline', level: 2 });
    expect(heading.parentElement?.className).toContain('border-b');
  });

  it('CardHead actions sit beside the heading: its accessible name is the title only', async () => {
    const onClick = vi.fn();
    render(
      <CardHead actions={<button type="button" onClick={onClick}>Add line</button>}>Billing summary</CardHead>,
    );
    // Exact name: the action's text must not leak into the heading (UIP-005 regression).
    const heading = screen.getByRole('heading', { name: 'Billing summary', exact: true });
    expect(heading).not.toContainElement(screen.getByRole('button', { name: 'Add line' }));
    // The action stays operable and shares the header row.
    await userEvent.click(screen.getByRole('button', { name: 'Add line' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Add line' }).closest('[class*="border-b"]')).toBe(heading.parentElement);
  });

  it('CardHead forwards ref, id and tabIndex to the heading element (not the wrapper)', () => {
    const ref = React.createRef<HTMLHeadingElement>();
    render(<CardHead ref={ref} id="h" tabIndex={-1} actions={<button type="button">x</button>}>Title</CardHead>);
    const heading = screen.getByRole('heading', { name: 'Title' });
    expect(ref.current).toBe(heading);
    expect(heading).toHaveAttribute('id', 'h');
    expect(heading).toHaveAttribute('tabindex', '-1');
  });

  it('CardHead without actions renders no empty actions container', () => {
    render(<CardHead>Solo</CardHead>);
    expect(screen.getByRole('heading', { name: 'Solo' }).parentElement?.children).toHaveLength(1);
  });

  it('CardHead accepts an explicit heading level', () => {
    render(<CardHead level={3}>Delivery overview</CardHead>);
    expect(screen.getByRole('heading', { name: 'Delivery overview', level: 3 })).toBeInTheDocument();
  });

  it('CardPad applies 16px padding', () => {
    render(<CardPad>inner</CardPad>);
    expect(screen.getByText('inner').className).toContain('p-4');
  });

  // ── content-over-containers (monochrome-calm reskin, L2-RECORD) ──────────
  // `variant="bare"` drops the card frame so a section sits directly on the canvas
  // (heading + content, separated from neighbors by whitespace + an optional hairline).
  // Default (`framed`) keeps the border + bg-card + rounding — unchanged everywhere else.
  it('variant="bare": no card frame — content sits on the canvas', () => {
    render(<Card variant="bare">body</Card>);
    const card = screen.getByText('body');
    expect(card.className).not.toContain('border-border');
    expect(card.className).not.toContain('bg-card');
    expect(card.className).not.toContain('rounded-lg');
  });
});
