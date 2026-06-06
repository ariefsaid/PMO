import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusPill, Badge } from '../StatusPill';

describe('StatusPill', () => {
  it('renders the label and a leading dot (never color-only)', () => {
    render(<StatusPill variant="open">Open</StatusPill>);
    const pill = screen.getByText('Open').closest('span');
    expect(pill).toBeInTheDocument();
    // dot is present alongside the text
    expect(pill?.querySelector('[data-pill-dot]')).toBeInTheDocument();
  });

  it('#4: label text is 12px per DESIGN.md label token (not text-xs which is 10.5px on 14px base)', () => {
    render(<StatusPill variant="open">Check size</StatusPill>);
    const pill = screen.getByText('Check size').closest('span')!;
    // Must use text-[12px] explicit pixel class, not text-xs (which resolves to 0.75rem = 10.5px on our 14px base)
    expect(pill.className).toContain('text-[12px]');
    expect(pill.className).not.toContain('text-xs');
  });

  it('uses the DARKENED AA text variant, not the base hue, for won', () => {
    render(<StatusPill variant="won">Won</StatusPill>);
    const pill = screen.getByText('Won').closest('span')!;
    expect(pill.className).toContain('bg-success/12');
    // jsdom resolves hsl() → rgb(). The darkened text hsl(142 64% 30%) == rgb(28,125,63),
    // NOT the base success hue hsl(142 71% 45%) == rgb(33,196,93).
    expect(pill.style.color).toBe('rgb(28, 126, 63)');
  });

  it('maps lost to the destructive tint + darkened red text', () => {
    render(<StatusPill variant="lost">Lost</StatusPill>);
    const pill = screen.getByText('Lost').closest('span')!;
    expect(pill.className).toContain('bg-destructive/10');
    // hsl(0 72% 45%) == rgb(197,32,32) — the darkened red, not base destructive.
    expect(pill.style.color).toBe('rgb(197, 32, 32)');
  });

  it('maps warn/overdue to the warning tint + warning-foreground token text', () => {
    render(<StatusPill variant="warn">Overdue</StatusPill>);
    const pill = screen.getByText('Overdue').closest('span')!;
    expect(pill.className).toContain('bg-warning/18');
    expect(pill.className).toContain('text-warning-foreground');
  });

  it('neutral uses secondary bg + muted-foreground text', () => {
    render(<StatusPill variant="neutral">Draft</StatusPill>);
    const pill = screen.getByText('Draft').closest('span')!;
    expect(pill.className).toContain('bg-secondary');
    expect(pill.className).toContain('text-muted-foreground');
  });
});

describe('Badge (count)', () => {
  it('renders secondary by default', () => {
    render(<Badge>4</Badge>);
    expect(screen.getByText('4').className).toContain('bg-secondary');
  });

  it('flips to primary tint when active', () => {
    render(<Badge active>4</Badge>);
    const b = screen.getByText('4');
    expect(b.className).toContain('bg-primary/15');
    expect(b.className).toContain('text-primary');
  });
});
