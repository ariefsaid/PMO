import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('CardHead renders a titled header with a bottom border', () => {
    render(<CardHead>Pipeline</CardHead>);
    const head = screen.getByText('Pipeline');
    expect(head.className).toContain('border-b');
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
