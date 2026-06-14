/**
 * Enforcement guard: stage/status indicators do NOT use action-blue (Part 2).
 *
 * The Freed-Blue Status Rule (DESIGN.md §2): action-blue (`primary`) is reserved for
 * interactive affordances — it must NOT appear on stage/status/quantity indicators.
 *
 * Verified:
 *   (a) LifecycleStepper inline pip: `done` pip must be SUCCESS green, not primary blue.
 *   (b) LifecycleStepper inline pip: connector line between done pips is NOT bg-primary.
 *   (c) LifecycleStepper bar: `done` bar is SUCCESS green (already correct — non-regression).
 *   (d) HoursBar fill: quantity bar must use a non-primary token (muted/secondary) NOT bg-primary.
 *
 * Note on salesPipeline.ts "Negotiation" dot: that dotColor is `hsl(var(--primary))` intentionally —
 * per DESIGN.md §5 funnel legend "C2 de-rainbow: … the closest-to-close open stage (Negotiation)
 * carries the ONE blue primary accent". The audit verdict #4 flags this but the DESIGN.md explicitly
 * allows this single accent. We do NOT enforce against it here to avoid contradicting the design oracle.
 * The HoursBar fill (a pure quantity indicator, no stage identity) is a different case — it should
 * be neutral/secondary so it does not read as an interactive affordance.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

import { LifecycleStepper } from '../LifecycleStepper';
import { HoursBar } from '../HoursBar';

// ── (a + b + c) LifecycleStepper ────────────────────────────────────────────

describe('LifecycleStepper — Freed-Blue enforcement (Part 2)', () => {
  it('(a) inline variant: done pip uses bg-success, NOT bg-primary', () => {
    const { container } = render(
      <LifecycleStepper
        variant="inline"
        aria-label="test stepper"
        steps={[
          { label: 'Step 1', state: 'done' },
          { label: 'Step 2', state: 'current' },
        ]}
      />,
    );
    // The done pip (first listitem) must carry bg-success, not bg-primary.
    const pips = container.querySelectorAll('[role="listitem"]');
    expect(pips.length).toBeGreaterThan(0);
    const donePip = pips[0]; // first step is 'done'
    expect(donePip.className).toMatch(/bg-success/);
    expect(donePip.className).not.toMatch(/bg-primary\b/);
  });

  it('(b) inline variant: connector between done pips does NOT use bg-primary', () => {
    const { container } = render(
      <LifecycleStepper
        variant="inline"
        aria-label="test stepper"
        steps={[
          { label: 'Step 1', state: 'done' },
          { label: 'Step 2', state: 'done' },
          { label: 'Step 3', state: 'current' },
        ]}
      />,
    );
    // The connector spans (aria-hidden) between done pips should NOT use bg-primary.
    // They can use bg-success/50 or bg-border — not the action blue.
    const connectors = container.querySelectorAll('span[aria-hidden="true"]');
    for (const connector of connectors) {
      // We only check connectors that are h-0.5 w-2.5 (the pipeline links)
      if (connector.className.includes('h-0.5')) {
        expect(connector.className).not.toMatch(/bg-primary\b/);
      }
    }
  });

  it('(c) bar variant: done bar uses bg-success, NOT bg-primary (non-regression)', () => {
    const { container } = render(
      <LifecycleStepper
        variant="bar"
        aria-label="test stepper"
        steps={[
          { label: 'Step 1', state: 'done' },
          { label: 'Step 2', state: 'current' },
        ]}
      />,
    );
    // Inside the first step (done), the fill span must use bg-success.
    const steps = container.querySelectorAll('[role="listitem"]');
    const doneStep = steps[0];
    const fillSpan = doneStep.querySelector('span span');
    expect(fillSpan?.className).toMatch(/bg-success/);
    expect(fillSpan?.className).not.toMatch(/bg-primary\b/);
  });
});

// ── (d) HoursBar ─────────────────────────────────────────────────────────────

describe('HoursBar — Freed-Blue enforcement (Part 2)', () => {
  it('(d) quantity bar fill does NOT use bg-primary (not an interactive affordance)', () => {
    const { container } = render(
      <HoursBar label="Project Alpha" code="PRJ-001" hours={40} maxHours={80} />,
    );
    // The fill span must not carry bg-primary (that is the interactive/action token).
    // It should carry a neutral token (bg-muted-foreground, bg-secondary, etc.).
    const progressbar = container.querySelector('[role="progressbar"]');
    expect(progressbar).not.toBeNull();
    const fill = progressbar!.querySelector('span');
    expect(fill).not.toBeNull();
    expect(fill!.className).not.toMatch(/bg-primary\b/);
  });
});
