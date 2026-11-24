import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { allowedActions } from './mainAction';

const t = ((_key: string, fallback?: string) => fallback ?? _key) as unknown as TFunction;
const ordered = (status: Parameters<typeof allowedActions>[0], role: string, mayOrderByRole: boolean) =>
  allowedActions(status, role, false, false, t, true, false, true, mayOrderByRole).some((a) => a.to === 'Ordered');

describe('AC-RTD-015 Generate Purchase Order for a person who orders by built-in role', () => {
  it('is offered on an approved purchase and after a quote is selected', () => {
    expect(ordered('Approved', 'Engineer', true)).toBe(true);
    expect(ordered('Quote Selected', 'Engineer', true)).toBe(true);
  });
  it('is never offered on a purchase that has not been approved', () => {
    expect(ordered('Draft', 'Engineer', true)).toBe(false);
    expect(ordered('Requested', 'Engineer', true)).toBe(false);
  });
  it('without the ordering role an Engineer is offered nothing, and today\'s levels are unchanged', () => {
    expect(ordered('Approved', 'Engineer', false)).toBe(false);
    expect(ordered('Approved', 'Project Manager', false)).toBe(true);
  });
  it('AC-BQS-001 the ordering role offers quotations without approval', () => {
    const actions = allowedActions('Requested', 'Engineer', false, false, t, true, false, true, true).map((a) => a.to);
    expect(actions).not.toContain('Approved');
    expect(allowedActions('Approved', 'Engineer', false, false, t, true, false, true, true).map((a) => a.to)).toContain('Vendor Quoted');
  });
});
