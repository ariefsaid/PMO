import { describe, it, expect } from 'vitest';
import type { TFunction } from 'i18next';
import { mayDecideRoutedApproval, approvalRouteNote, type ApprovalRoute } from './approvalRoute';

// Minimal t: returns the fallback, interpolating {{x}} from the options object.
const t = ((key: string, opt?: string | Record<string, string>) => {
  if (typeof opt === 'string') return opt;
  const o = opt ?? {};
  return (o.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => o[k] ?? '');
}) as unknown as TFunction;

const route = (over: Partial<ApprovalRoute> = {}): ApprovalRoute => ({
  procurementId: 'p1',
  route: 'project',
  reason: 'within_budget',
  approvers: [{ id: 'u-a', fullName: 'Ana Approver' }],
  requestAmount: 400,
  lineBudget: 1000,
  lineUsed: 0,
  ...over,
});

describe('AC-APR-030 mayDecideRoutedApproval', () => {
  it('AC-APR-030: no route adds no restriction (FR-APR-035)', () => {
    expect(mayDecideRoutedApproval(undefined, 'u-x', false)).toBe(true);
  });
  it('AC-APR-030: a flat route adds no restriction', () => {
    expect(mayDecideRoutedApproval(route({ route: 'flat', approvers: [] }), 'u-x', false)).toBe(true);
  });
  it('AC-APR-030: a named approver may decide', () => {
    expect(mayDecideRoutedApproval(route(), 'u-a', false)).toBe(true);
  });
  it('AC-APR-030: an un-named viewer may not', () => {
    expect(mayDecideRoutedApproval(route(), 'u-x', false)).toBe(false);
  });
  it('AC-APR-030: a viewer with no id may not', () => {
    expect(mayDecideRoutedApproval(route(), undefined, false)).toBe(false);
  });
  it('AC-APR-030: an Admin keeps break-glass', () => {
    expect(mayDecideRoutedApproval(route(), 'u-x', true)).toBe(true);
  });
});

describe('AC-APR-030 approvalRouteNote', () => {
  it('AC-APR-030: names the approver and the within-budget line', () => {
    expect(approvalRouteNote(route(), 'Materials', t)).toBe(
      "Approval for this request is routed to Ana Approver: it is within the project's Materials budget.",
    );
  });
  it('AC-APR-030: joins a senior set with "or" and states overhead', () => {
    const r = route({
      route: 'org',
      reason: 'no_project',
      approvers: [{ id: 'u-1', fullName: 'Ena' }, { id: 'u-2', fullName: 'Fin' }],
    });
    expect(approvalRouteNote(r, null, t)).toBe(
      'Approval for this request is routed to Ena or Fin: it is overhead spend, not charged to a project.',
    );
  });
  it('AC-APR-030: an escalated within-budget request says the project approver cannot act', () => {
    expect(approvalRouteNote(route({ route: 'org' }), 'Materials', t)).toContain(
      "the project's own approver cannot approve it.",
    );
  });
  it('AC-APR-030: over-line names the category', () => {
    expect(approvalRouteNote(route({ route: 'org', reason: 'exceeds_line' }), 'Labor', t)).toContain(
      "would take the project's Labor budget over its limit",
    );
  });
});
