import { describe, it, expect } from 'vitest';
import { pillVariantForProjectStatus, projectIconColor } from './projects';

describe('pillVariantForProjectStatus', () => {
  // Freed-Blue Status Rule (CW-2): on-hand execution is neutral grey `progress`,
  // NOT the action-blue — the distinct LABEL carries identity.
  it('maps Ongoing-style on-hand statuses to progress (neutral grey, never blue)', () => {
    expect(pillVariantForProjectStatus('Ongoing Project')).toBe('progress');
    expect(pillVariantForProjectStatus('Ongoing Project')).not.toBe('open');
  });
  it('maps Won, Pending KoM to won (green)', () => {
    expect(pillVariantForProjectStatus('Won, Pending KoM')).toBe('won');
  });
  it('maps On Hold to warn (amber — ADR-0029: registry `warn`, not the old local `overdue`)', () => {
    // ADR-0029 re-points this helper to the CW-2 registry. Registry uses `warn` for
    // awaiting-action / at-risk states; the old local map used `overdue`. Both are
    // amber — this is a token-name correction, not a visible-tint regression.
    expect(pillVariantForProjectStatus('On Hold')).toBe('warn');
  });
  it('maps Loss Tender to lost (red)', () => {
    expect(pillVariantForProjectStatus('Loss Tender')).toBe('lost');
  });
  it('maps pipeline lead statuses to draft (neutral)', () => {
    expect(pillVariantForProjectStatus('Leads')).toBe('draft');
    expect(pillVariantForProjectStatus('PQ Submitted')).toBe('draft');
    expect(pillVariantForProjectStatus('Tender Submitted')).toBe('draft');
  });
  it('maps Close Out to won (positive terminal)', () => {
    expect(pillVariantForProjectStatus('Close Out')).toBe('won');
  });
  it('falls back to neutral for an unknown status', () => {
    expect(pillVariantForProjectStatus('Something Else')).toBe('neutral');
  });
});

describe('projectIconColor', () => {
  it('returns the violet token for the project icon tile (one named categorical token)', () => {
    expect(projectIconColor()).toBe('hsl(var(--violet))');
  });
});
