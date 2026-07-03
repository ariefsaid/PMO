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

  /**
   * ADR-0037 (S1): the slab is gone. Status is now a quiet dot + label on the
   * surrounding surface — NO filled tint background, NO pill chrome (rounded-full /
   * horizontal padding). Assert the new (non-slab) treatment positively.
   */
  it('S1: renders as dot + label with NO filled tint background or pill chrome (no slab)', () => {
    render(<StatusPill variant="open">Open</StatusPill>);
    const pill = screen.getByText('Open').closest('span')!;
    // the slab fills are gone (the quiet-dot signature)
    expect(pill.className).not.toMatch(/\bbg-(primary|success|warning|destructive|secondary|violet)\b/);
    expect(pill.className).not.toContain('rounded-full'); // pill chrome removed (the dot keeps its own roundness)
    expect(pill.className).not.toMatch(/\b(pl|pr|px)-/); // no horizontal padding that draws a pill
    // the dot is still a round pip (its own rounded-full is correct — a dot is a circle)
    const dot = pill.querySelector('[data-pill-dot]') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.className).toContain('rounded-full');
    expect(dot.style.background).toBe('hsl(var(--primary))');
  });

  /**
   * I3 (CRITICAL): the `open` variant label text is the AA --status-open-text
   * token (221.2 83.2% 45% — 6.81:1 on the white canvas, ≥4.5:1). The token IS the
   * single source of truth for the label color. jsdom cannot resolve var() → rgb(),
   * so we assert the raw style attribute wires the correct token.
   */
  it('I3: open variant label is wired to --status-open-text token (221.2 83.2% 45%, AA ≥4.5:1 on canvas)', () => {
    render(<StatusPill variant="open">Submitted</StatusPill>);
    const pill = screen.getByText('Submitted').closest('span')!;
    // Token = --status-open-text: 221.2 83.2% 45% (hsl clears AA ≥4.5:1 on the plain surface).
    // jsdom stores hsl(var(--x)) verbatim in style.color — assert the attribute string.
    expect(pill.getAttribute('style') ?? '').toContain('--status-open-text');
  });

  it('#4: label text is 12px per DESIGN.md label token (explicit text-[12px], not the rem-scale text-xs)', () => {
    render(<StatusPill variant="open">Check size</StatusPill>);
    const pill = screen.getByText('Check size').closest('span')!;
    // Pin the DESIGN.md 12px label token with an explicit pixel class so the pill
    // size is immune to the root rem scale, rather than the rem-derived text-xs.
    expect(pill.className).toContain('text-[12px]');
    expect(pill.className).not.toContain('text-xs');
  });

  it('maps won to the success dot + AA success label token (--status-won-text = 142 64% 27%, ≥6:1 canvas)', () => {
    render(<StatusPill variant="won">Won</StatusPill>);
    const pill = screen.getByText('Won').closest('span')!;
    // S1: the success tint slab is gone — label color now comes from the AA token.
    expect(pill.className).not.toContain('bg-success');
    expect(pill.getAttribute('style') ?? '').toContain('--status-won-text');
    const dot = pill.querySelector('[data-pill-dot]') as HTMLElement;
    expect(dot.style.background).toBe('hsl(var(--success))');
  });

  it('maps lost to the destructive dot + AA red label token (--status-lost-text = 0 72% 44%, ≥6:1 canvas)', () => {
    render(<StatusPill variant="lost">Lost</StatusPill>);
    const pill = screen.getByText('Lost').closest('span')!;
    expect(pill.className).not.toContain('bg-destructive');
    expect(pill.getAttribute('style') ?? '').toContain('--status-lost-text');
    const dot = pill.querySelector('[data-pill-dot]') as HTMLElement;
    expect(dot.style.background).toBe('hsl(var(--destructive))');
  });

  it('maps warn/overdue to the warning dot + AA amber label (text-warning-foreground token, no slab)', () => {
    render(<StatusPill variant="warn">Overdue</StatusPill>);
    const pill = screen.getByText('Overdue').closest('span')!;
    // S1: the warning tint slab is gone — the amber AA label now sits on the surface.
    expect(pill.className).not.toContain('bg-warning');
    expect(pill.className).toContain('text-warning-foreground');
    const dot = pill.querySelector('[data-pill-dot]') as HTMLElement;
    expect(dot.style.background).toBe('hsl(var(--warning))');
  });

  it('neutral renders a muted dot + muted-foreground label (no slab)', () => {
    render(<StatusPill variant="neutral">Draft</StatusPill>);
    const pill = screen.getByText('Draft').closest('span')!;
    expect(pill.className).not.toContain('bg-secondary');
    expect(pill.className).toContain('text-muted-foreground');
    const dot = pill.querySelector('[data-pill-dot]') as HTMLElement;
    expect(dot.style.background).toBe('hsl(var(--muted-foreground))');
  });

  /**
   * I1: the in-flight `progress` variant — a quiet neutral (muted dot + muted
   * label) so non-active procurement stages are differentiated from the single
   * blue `open` by the blue DOT + LABEL, not by inventing a per-stage hue (which
   * would recreate the rainbow on pills).
   */
  it('I1: progress variant is a quiet muted dot + muted-foreground label (no slab)', () => {
    render(<StatusPill variant="progress">Purchase Order</StatusPill>);
    const pill = screen.getByText('Purchase Order').closest('span')!;
    expect(pill.className).not.toContain('bg-secondary');
    expect(pill.className).toContain('text-muted-foreground');
    const dot = pill.querySelector('[data-pill-dot]') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.style.background).toBe('hsl(var(--muted-foreground))');
  });

  it('I1: open stays the blue dot + darkened-AA token label (progress did not change open)', () => {
    render(<StatusPill variant="open">Submitted</StatusPill>);
    const pill = screen.getByText('Submitted').closest('span')!;
    expect(pill.className).not.toContain('bg-primary');
    // wired to --status-open-text token (jsdom stores hsl(var(--x)) verbatim).
    expect(pill.getAttribute('style') ?? '').toContain('--status-open-text');
    const dot = pill.querySelector('[data-pill-dot]') as HTMLElement;
    expect(dot.style.background).toBe('hsl(var(--primary))');
  });

  /**
   * Categorical `violet` variant — the third status hue (Companies type = Vendor).
   * DESIGN.md sanctions violet for NON-interactive categorization (type pills are
   * not actions). A violet DOT + the AA --status-violet-text label (262 60% 42%,
   * ~7.4:1 on white). Distinct from open (blue) and won (green) so the three
   * company types are differentiated by hue AND label, never color-only.
   */
  it('maps violet to the violet dot + AA violet label token (Vendor type pill, no slab)', () => {
    render(<StatusPill variant="violet">Vendor</StatusPill>);
    const pill = screen.getByText('Vendor').closest('span')!;
    expect(pill.className).not.toContain('bg-violet');
    expect(pill.getAttribute('style') ?? '').toContain('--status-violet-text');
    const dot = pill.querySelector('[data-pill-dot]') as HTMLElement;
    expect(dot.style.background).toBe('hsl(var(--violet))');
  });

  it('AC-W6-H3: open/won/lost/violet label references the documented --status-*-text tokens (token = source of truth)', () => {
    // Each colored variant applies hsl(var(--status-*-text)) as the inline label
    // color — the token IS the single source of truth. jsdom stores hsl(var(--x))
    // verbatim, so we assert the raw style attribute contains the token name.
    const pairs: Array<[Parameters<typeof StatusPill>[0]['variant'], string]> = [
      ['open', '--status-open-text'],
      ['won', '--status-won-text'],
      ['lost', '--status-lost-text'],
      ['violet', '--status-violet-text'],
    ];
    for (const [variant, token] of pairs) {
      const { unmount } = render(<StatusPill variant={variant}>{variant}</StatusPill>);
      const pill = screen.getByText(variant).closest('span')!;
      expect(pill.getAttribute('style') ?? '', `${variant} should reference ${token}`).toContain(token);
      unmount();
    }
  });
});

describe('StatusPill — superseded variant (AC-DOC-081)', () => {
  it('AC-DOC-081: superseded variant renders muted dot + "Superseded" label', () => {
    render(<StatusPill variant="superseded">Superseded</StatusPill>);
    const pill = screen.getByText('Superseded');
    expect(pill).toBeInTheDocument();
    // The dot is rendered (data-pill-dot attribute)
    expect(pill.querySelector('[data-pill-dot]') ?? pill.closest('span')?.querySelector('[data-pill-dot]')).toBeInTheDocument();
  });

  it('AC-DOC-081: superseded pill has correct aria-label', () => {
    render(<StatusPill variant="superseded" aria-label="Status: Superseded">Superseded</StatusPill>);
    expect(screen.getByLabelText('Status: Superseded')).toBeInTheDocument();
  });

  it('AC-DOC-081: superseded is a quiet muted dot + muted-foreground label (no slab)', () => {
    render(<StatusPill variant="superseded">Superseded</StatusPill>);
    const pill = screen.getByText('Superseded').closest('span')!;
    expect(pill.className).not.toContain('bg-secondary');
    expect(pill.className).toContain('text-muted-foreground');
    const dot = pill.querySelector('[data-pill-dot]') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.style.background).toBe('hsl(var(--muted-foreground))');
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
