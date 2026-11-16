import { readFileSync } from 'node:fs';
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
  it('AC-APR-010: a request only an Admin may decide is not decidable by a non-Admin', () => {
    expect(mayDecideRoutedApproval(route({ route: 'admin', approvers: [] }), 'u-x', false)).toBe(false);
  });
  it('AC-APR-010: a request only an Admin may decide is decidable by an Admin', () => {
    expect(mayDecideRoutedApproval(route({ route: 'admin', approvers: [] }), 'u-x', true)).toBe(true);
  });
});

describe('AC-APR-030 approvalRouteNote', () => {
  it('AC-APR-030: names the approver and the within-budget line', () => {
    expect(approvalRouteNote(route(), 'Materials', t)).toBe(
      "Approval for this procurement is routed to Ana Approver: it is within the project's Materials budget.",
    );
  });
  it('AC-APR-033: a request seen below approval rank says who decides it, with no figure', () => {
    const note = approvalRouteNote(route({ route: 'org', reason: 'spending_not_visible' }), 'Materials', t);
    expect(note).toBe(
      "Approval for this procurement is routed to Ana Approver: whether it fits the project's Materials budget is checked when it is decided.",
    );
    expect(note).not.toContain('within');
  });
  it('AC-APR-032: spending that is not known says so', () => {
    expect(approvalRouteNote(route({ route: 'org', reason: 'spending_unknown' }), 'Materials', t)).toContain(
      "what is already spent on the project's Materials budget is not known yet.",
    );
  });
  it('AC-APR-031: over the project budget counting what is spent', () => {
    expect(approvalRouteNote(route({ route: 'org', reason: 'exceeds_project' }), 'Materials', t)).toContain(
      "it would take the project's budget over its limit, counting what is already spent.",
    );
  });
  it('AC-APR-030: joins a senior set with "or" and states overhead', () => {
    const r = route({
      route: 'org',
      reason: 'no_project',
      approvers: [{ id: 'u-1', fullName: 'Ena' }, { id: 'u-2', fullName: 'Fin' }],
    });
    expect(approvalRouteNote(r, null, t)).toBe(
      'Approval for this procurement is routed to Ena or Fin: it is overhead spend, not charged to a project.',
    );
  });
  it('AC-APR-030: an escalated within-budget request says the project approver cannot act', () => {
    expect(approvalRouteNote(route({ route: 'org' }), 'Materials', t)).toContain(
      "the project's own approver cannot approve it.",
    );
  });
  it('AC-APR-010: a request only an Admin may decide says so instead of naming nobody', () => {
    expect(approvalRouteNote(route({ route: 'admin', reason: 'no_project', approvers: [] }), null, t)).toBe(
      'Approval for this procurement needs an Admin: no one in the senior approver set can act on it.',
    );
  });
  it('DD-APR-3: a budget changed under the request says why it went to the senior set', () => {
    expect(approvalRouteNote(route({ route: 'org', reason: 'budget_changed' }), 'Materials', t)).toContain(
      'activated after it was submitted, or by the person deciding it',
    );
  });
  it('DD-APR-5: a negative amount says why it went to the senior set', () => {
    expect(approvalRouteNote(route({ route: 'org', reason: 'amount_invalid' }), 'Materials', t)).toContain(
      'includes a negative value',
    );
  });
  it('AC-APR-030: over-line names the category', () => {
    expect(approvalRouteNote(route({ route: 'org', reason: 'exceeds_line' }), 'Labor', t)).toContain(
      "would take the project's Labor budget over its limit, counting what is already spent.",
    );
  });
});

describe('AC-APR-031..033 reason wording in both languages', () => {
  type Catalogue = { procurementDetail: { route: { why: Record<string, string> } }; routeWhy: Record<string, string> };
  const read = (lang: string, file: string) => JSON.parse(readFileSync(`public/locales/${lang}/${file}.json`, 'utf8')) as Catalogue;
  const why = (lang: string) => read(lang, 'common').procurementDetail.route.why;
  const wording = (lang: string, key: string) => (key === 'exceedsLine' ? why(lang).exceedsLine : read(lang, 'procurement').routeWhy[key]);
  it.each(['exceedsLine', 'exceedsProject', 'spendingUnknown', 'spendingNotVisible'])('%s is written in en and id', (key) => {
    expect(wording('en', key)).toBeTruthy();
    expect(wording('id', key)).toBeTruthy();
    expect(wording('id', key)).not.toBe(wording('en', key));
  });
  it('the below-rank sentence is gone: the server now names who decides', () => {
    expect(why('en').projectApprover).toBeUndefined();
    expect(why('id').projectApprover).toBeUndefined();
  });
});
