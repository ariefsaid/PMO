import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Card, CardHead, CardPad } from '../Card';

describe('Card', () => {
  it('static card has a border and NO rest shadow (Flat-By-Default)', () => {
    render(<Card>body</Card>);
    const card = screen.getByText('body');
    expect(card.className).toContain('panel-card');
    expect(card.className).not.toMatch(/shadow-\[/);
  });

  it('seam variant squares the bottom corners (sits above a table)', () => {
    render(<Card seam>body</Card>);
    expect(screen.getByText('body').className).toContain('panel-card-seam');
  });

  it('CardHead renders a titled header without a divider and keeps a navigable heading level', () => {
    render(<CardHead>Pipeline</CardHead>);
    // Default sits one level under the page h1 (no h1 -> h3 skip); explicit level for nested cards.
    const heading = screen.getByRole('heading', { name: 'Pipeline', level: 2 });
    expect(heading.parentElement?.parentElement).not.toHaveClass('border-b');
  });

  it('CardHead actions sit beside the heading: its accessible name is the title only', async () => {
    const onClick = vi.fn();
    render(
      <CardHead actions={<button type="button" onClick={onClick}>Add line</button>}>Billing summary</CardHead>,
    );
    // Exact name: the action's text must not leak into the heading (UIP-005 regression).
    const heading = screen.getByRole('heading', { name: 'Billing summary' });
    expect(heading).not.toContainElement(screen.getByRole('button', { name: 'Add line' }));
    // The action stays operable and shares the header row.
    await userEvent.click(screen.getByRole('button', { name: 'Add line' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Add line' }).closest('[class*="border-b"]')).toBe(heading.closest('[class*="border-b"]'));
  });

  it('CardHead keeps an optional subline outside the heading name', () => {
    const HeadWithSubline = CardHead as React.FC<React.ComponentProps<typeof CardHead> & { subline: React.ReactNode }>;
    render(<HeadWithSubline subline="Updated through 27 Oct">Project finances</HeadWithSubline>);
    expect(screen.getByRole('heading', { name: 'Project finances' })).toBeInTheDocument();
    expect(screen.getByText('Updated through 27 Oct')).toBeInTheDocument();
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

  it('CardPad uses the responsive panel inset', () => {
    render(<CardPad>inner</CardPad>);
    expect(screen.getByText('inner').className).toContain('p-[var(--panel-inset)]');
  });

  it('CardPad can keep a table flush with the panel edge', () => {
    render(<CardPad flush>table</CardPad>);
    expect(screen.getByText('table').className).toContain('p-0');
  });

  // `variant="bare"` keeps content inside an existing panel from drawing another frame.
  it('variant="bare": no card frame — content sits on the canvas', () => {
    render(<Card variant="bare">body</Card>);
    const card = screen.getByText('body');
    expect(card.className).not.toContain('panel-card');
    expect(card.className).not.toContain('border-border');
    expect(card.className).not.toContain('bg-card');
    expect(card.className).not.toContain('rounded-lg');
  });
});
