import { describe, expect, it } from 'vitest';
import type { ApprovalPopulationEntry } from '@/src/lib/selectors/approvals';
import { approvalItem } from './approvalItem';

const t = (_key: string, fallback: string) => fallback;
const now = new Date('2026-11-12T12:00:00Z').getTime();

describe('approval work-list items (what · who · amount · how long)', () => {
  it('a procurement request names its title, requester and amount, and opens the request', () => {
    const entry = { key: 'procurement:p1', kind: 'procurement', createdAt: '2026-11-02T12:00:00Z', row: { id: 'p1', title: 'Site lighting', requested_by: { full_name: 'Dana Ruiz' }, total_value: 3400, currency: 'USD' } } as unknown as ApprovalPopulationEntry;
    expect(approvalItem(entry, t, now)).toEqual({ key: 'procurement:p1', what: 'Site lighting', who: 'Dana Ruiz', amount: '$3.4K', days: 10, href: '/procurement/p1' });
  });
  it('an expense claim opens the claim with the claimant and amount', () => {
    const entry = { key: 'expense:e1', kind: 'expense', createdAt: '2026-11-12T08:00:00Z', row: { claim: { id: 'e1', title: 'Taxi', claimant: { full_name: 'Ari' }, amount: 25, currency: 'USD', float: null }, route: null } } as unknown as ApprovalPopulationEntry;
    expect(approvalItem(entry, t, now)).toMatchObject({ what: 'Taxi', who: 'Ari', days: 0, href: '/expenses/e1' });
  });
  it('a timesheet has no amount (never a 0) and opens the timesheet approvals', () => {
    const entry = { key: 'timesheets:t1', kind: 'timesheets', createdAt: '2026-11-09', row: { id: 't1', owner: { full_name: 'Ivan', manager_id: null } } } as unknown as ApprovalPopulationEntry;
    expect(approvalItem(entry, t, now)).toMatchObject({ what: 'Timesheet', who: 'Ivan', amount: null, href: '/approvals?scope=timesheets' });
  });
});
