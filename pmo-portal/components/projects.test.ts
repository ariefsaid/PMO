import { describe, it, expect } from 'vitest';
import { pillVariantForProjectStatus, projectIconColor } from './projects';

describe('pillVariantForProjectStatus', () => {
  it('maps Ongoing-style on-hand statuses to open (blue)', () => {
    expect(pillVariantForProjectStatus('Ongoing Project')).toBe('open');
  });
  it('maps Won, Pending KoM to won (green)', () => {
    expect(pillVariantForProjectStatus('Won, Pending KoM')).toBe('won');
  });
  it('maps On Hold to overdue (amber)', () => {
    expect(pillVariantForProjectStatus('On Hold')).toBe('overdue');
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
