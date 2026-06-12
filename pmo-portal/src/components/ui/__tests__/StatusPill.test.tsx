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
   * I3 (CRITICAL): the `open` variant text must be darkened to ≥4.5:1 against
   * its primary/10 background. The token --status-open-text = 221 75% 38% clears
   * 4.5:1 (was hsl(221 70% 45%) = 3.15:1). Wave-6 H3: the component now references
   * the token via hsl(var(--status-open-text)) — jsdom cannot resolve var() → rgb(),
   * so we assert the raw style attribute wires the correct token.
   */
  it('I3: open variant text is wired to --status-open-text token (221 75% 38%, AA-compliant ≥4.5:1)', () => {
    render(<StatusPill variant="open">Submitted</StatusPill>);
    const pill = screen.getByText('Submitted').closest('span')!;
    // Token = --status-open-text: 221 75% 38% (hsl(221 75% 38%) clears AA ≥4.5:1).
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

  it('uses the DARKENED AA text token for won (--status-won-text = 142 64% 30%)', () => {
    render(<StatusPill variant="won">Won</StatusPill>);
    const pill = screen.getByText('Won').closest('span')!;
    expect(pill.className).toContain('bg-success/12');
    // Wave-6 H3: token --status-won-text = 142 64% 30% (hsl(142 64% 30%) clears AA ≥4.5:1,
    // distinct from base success hsl(142 71% 45%)). jsdom stores hsl(var(--x)) verbatim.
    expect(pill.getAttribute('style') ?? '').toContain('--status-won-text');
  });

  it('maps lost to the destructive tint + darkened red token (--status-lost-text = 0 72% 45%)', () => {
    render(<StatusPill variant="lost">Lost</StatusPill>);
    const pill = screen.getByText('Lost').closest('span')!;
    expect(pill.className).toContain('bg-destructive/10');
    // Wave-6 H3: token --status-lost-text = 0 72% 45% (darkened red, distinct from base destructive).
    // jsdom stores hsl(var(--x)) verbatim — assert the raw style attribute references the token.
    expect(pill.getAttribute('style') ?? '').toContain('--status-lost-text');
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

  /**
   * I1: the in-flight `progress` variant — a quiet neutral pill (secondary fill +
   * secondary-foreground text + muted-foreground dot) so non-active procurement
   * stages are differentiated from the single blue `open` by tint AND label, not
   * by inventing a per-stage hue (which would recreate the rainbow on pills).
   */
  it('I1: progress variant is a quiet neutral pill (secondary fill, secondary-foreground text, muted dot)', () => {
    render(<StatusPill variant="progress">Purchase Order</StatusPill>);
    const pill = screen.getByText('Purchase Order').closest('span')!;
    expect(pill.className).toContain('bg-secondary');
    expect(pill.className).toContain('text-secondary-foreground');
    const dot = pill.querySelector('[data-pill-dot]') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.style.background).toBe('hsl(var(--muted-foreground))');
  });

  it('I1: open stays the blue tint + darkened-AA token text (progress did not change open)', () => {
    render(<StatusPill variant="open">Submitted</StatusPill>);
    const pill = screen.getByText('Submitted').closest('span')!;
    expect(pill.className).toContain('bg-primary/10');
    // Wave-6 H3: wired to --status-open-text token (jsdom stores hsl(var(--x)) verbatim).
    expect(pill.getAttribute('style') ?? '').toContain('--status-open-text');
  });

  /**
   * Categorical `violet` variant — the third pill hue (Companies type = Vendor).
   * DESIGN.md sanctions violet for NON-interactive categorization (type pills are
   * not actions). Tinted violet/12 bg + the darkened-AA text hsl(262 60% 42%) from
   * crud-companies.html (7.4:1 on white — clears AA). Distinct from open (blue) and
   * won/Internal (green) so the three company types are differentiated by hue AND
   * label, never color-only (the dot + label carry it).
   */
  it('maps violet to the categorical violet tint + darkened AA token text (Vendor type pill)', () => {
    render(<StatusPill variant="violet">Vendor</StatusPill>);
    const pill = screen.getByText('Vendor').closest('span')!;
    expect(pill.className).toContain('bg-violet/12');
    // Wave-6 H3: token --status-violet-text = 262 60% 42% (hsl(262 60% 42%) = 7.4:1 on white).
    // jsdom stores hsl(var(--x)) verbatim — assert the raw style attribute references the token.
    expect(pill.getAttribute('style') ?? '').toContain('--status-violet-text');
    const dot = pill.querySelector('[data-pill-dot]') as HTMLElement;
    expect(dot.style.background).toBe('hsl(var(--violet))');
  });

  it('AC-W6-H3: open/won/lost/violet pill text references the documented --status-*-text tokens (Wave-6 H3 real token swap)', () => {
    // Each variant applies hsl(var(--status-*-text)) as the inline color — the token IS the
    // single source of truth (not a comment alias). jsdom stores hsl(var(--x)) verbatim,
    // so we assert the raw style attribute contains the token name.
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
  it('AC-DOC-081: superseded variant renders grey pill with "Superseded" label', () => {
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

  it('AC-DOC-081: superseded reuses neutral/draft treatment (bg-secondary + muted-foreground)', () => {
    render(<StatusPill variant="superseded">Superseded</StatusPill>);
    const pill = screen.getByText('Superseded').closest('span')!;
    expect(pill.className).toContain('bg-secondary');
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
