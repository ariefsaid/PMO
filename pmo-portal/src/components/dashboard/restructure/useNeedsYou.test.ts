import { describe, expect, it } from 'vitest';
import { buildNeedsItems, selectSupplierInvoices, type NeedsYouFacts } from './useNeedsYou';

const translate = (key: string, fallback: string, options?: Record<string, unknown>) =>
  fallback.replace('{{count}}', String(options?.count ?? ''));

describe('needs-you dashboard selectors', () => {
  it('shows executive approvals, risk and procurement needs with their work destinations', () => {
    const items = buildNeedsItems('Executive', {
      approvals: 2, atRiskProjects: 1, procurementsAwaitingApproval: 3,
    }, translate);

    expect(items.map(({ count, href }) => [count, href])).toEqual([
      [2, '/approvals'],
      [1, '/projects?filter=at-risk'],
      [3, '/procurement?status=Requested'],
    ]);
  });

  it('shows Finance needs before the company overview and omits zero counts', () => {
    const items = buildNeedsItems('Finance', {
      approvals: 0,
      overdueInvoices: { count: 2, knownTotals: [], unknownBalances: 1, oldestDays: 8 },
      supplierInvoices: { count: 4, knownTotals: [], unknownBalances: 1 },
      readyToBill: 0,
      budgetsOver: 1,
    }, translate);

    expect(items.map(({ count, href }) => [count, href])).toEqual([
      [2, '/sales-invoices?overdue=true'],
      [4, '/procurement?status=Vendor+Invoiced'],
      [1, '/projects'],
    ]);
    expect(items[0].label).toContain('1 balance unknown');
    expect(items[1].label).toContain('Unknown balances: 1');
  });

  it('shows the Project Manager queue and links it to the owning work areas', () => {
    const items = buildNeedsItems('Project Manager', {
      approvals: 2, projectsOverBudget: 1, overdueProjectTasks: 5, timesheetsToApprove: 3,
    }, translate);

    expect(items.map(({ count, href }) => [count, href])).toEqual([
      [2, '/approvals'], [1, '/projects?filter=My+Projects'],
      [5, '/projects?filter=My+Projects'], [3, '/approvals?scope=timesheets'],
    ]);
  });

  it('shows only Engineer time, task and returned-expense needs', () => {
    const items = buildNeedsItems('Engineer', {
      timesheetStatus: 'Rejected', engineerTasks: 2, returnedExpenses: 1,
    }, translate);

    expect(items.map(({ count, href }) => [count, href])).toEqual([
      [1, '/timesheets'], [2, '/my-tasks'], [1, '/expenses'],
    ]);
    expect(items.map(({ label }) => label).join(' ')).not.toMatch(/\$|Rp|IDR/);
  });

  it('returns no rows when every source is known to be clear', () => {
    const clear: NeedsYouFacts = {
      approvals: 0, atRiskProjects: 0, procurementsAwaitingApproval: 0,
      overdueInvoices: { count: 0, knownTotals: [], unknownBalances: 0, oldestDays: null },
      supplierInvoices: { count: 0, knownTotals: [], unknownBalances: 0 }, readyToBill: 0, budgetsOver: 0,
      projectsOverBudget: 0, overdueProjectTasks: 0, timesheetsToApprove: 0,
      timesheetStatus: 'Approved', engineerTasks: 0, returnedExpenses: 0,
    };

    expect(buildNeedsItems('Admin', clear, translate)).toEqual([]);
    expect(buildNeedsItems('Finance', clear, translate)).toEqual([]);
    expect(buildNeedsItems('Project Manager', clear, translate)).toEqual([]);
    expect(buildNeedsItems('Engineer', clear, translate)).toEqual([]);
  });

  it('keeps supplier totals limited to known invoice balances and counts unknown balances', () => {
    const result = selectSupplierInvoices([
      { status: 'Vendor Invoiced', currency: 'USD', total_value: 125 },
      { status: 'Vendor Invoiced', currency: 'USD', total_value: null },
      { status: 'Paid', currency: 'USD', total_value: 500 },
    ] as never[]);

    expect(result).toEqual({ count: 2, knownTotals: [{ currency: 'USD', amount: 125 }], unknownBalances: 1 });
  });
});
