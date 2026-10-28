import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import i18next from 'i18next';
import { buildNeedsItems, selectSupplierInvoices, type NeedsYouFacts } from './useNeedsYou';

const translate = (key: string, fallback: string, options?: Record<string, unknown>) =>
  fallback.replace('{{count}}', String(options?.count ?? ''));

describe('needs-you dashboard selectors', () => {
  it('QI-5 labels a partial PM at-risk count as a floor', () => {
    const [item] = buildNeedsItems('Project Manager', {
      projectsOverBudget: 2,
      projectsOverBudgetPartial: true,
    }, translate);
    expect(item).toMatchObject({ id: 'projects-over-budget', count: 2, countLabel: 'At least 2' });
  });

  it('QI-5 says when no PM at-risk count can be checked', () => {
    const [item] = buildNeedsItems('Project Manager', {
      projectsOverBudget: 0,
      projectsOverBudgetUnknown: 3,
    }, translate);
    expect(item).toMatchObject({ id: 'projects-risk-unchecked', count: 3, tone: 'neutral' });
    expect(item?.label).toMatch(/without a checkable budget/i);
  });

  it('shows executive approvals, risk and procurement needs with their work destinations', () => {
    const items = buildNeedsItems('Executive', {
      approvals: 2, atRiskProjects: 1, procurementsAwaitingApproval: 3,
    }, translate);

    expect(items.map(({ count, href }) => [count, href])).toEqual([
      [2, '/approvals'],
      [1, '/projects?filter=at-risk'],
      [3, '/procurement?status=Requested'],
    ]);
    expect(items.map(({ label }) => label)).toEqual([
      'approvals waiting for you', 'project at risk', 'procurements awaiting approval',
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
    expect(items[1].label).not.toContain('4 supplier invoices to pay');
  });

  it('shows the Project Manager queue and links it to the owning work areas', () => {
    const items = buildNeedsItems('Project Manager', {
      approvals: 2, projectsOverBudget: 1, overdueProjectTasks: 5, timesheetsToApprove: 3,
    }, translate);

    expect(items.map(({ count, href }) => [count, href])).toEqual([
      [2, '/approvals'], [1, '/projects?filter=My+Projects'],
      [5, '/projects?filter=My+Projects'], [3, '/approvals?scope=timesheets'],
    ]);
    expect(items.map(({ label }) => label)).toEqual([
      'approvals waiting for you', 'project over 90% of budget',
      'overdue tasks on your projects', 'team timesheets to approve',
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
    expect(items.map(({ label }) => label)).toEqual([
      "This week's timesheet was returned", 'tasks overdue or due this week', 'expense claim returned',
    ]);
  });

  it('AC-RD-RISK-001: a zero at-risk count with unbudgeted active projects still says risk cannot be checked', () => {
    const items = buildNeedsItems('Executive', { atRiskProjects: 0, riskUncheckedProjects: 2 }, translate);
    expect(items.map((item) => item.id)).toEqual(['risk-unchecked']);
    expect(items[0]!.label).toMatch(/without an active budget; risk can't be checked yet/);
    expect(items[0]!.label).not.toMatch(/on track/i);
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

  it('keeps supplier totals limited to known unpaid invoice balances and counts unknown balances', () => {
    const result = selectSupplierInvoices([
      { status: 'Vendor Invoiced', currency: 'USD', total_value: 100, procurement_invoices: [{ amount: 125 }], payments: [] },
      { status: 'Vendor Invoiced', currency: 'USD', total_value: 100, procurement_invoices: [{ amount: null }], payments: [] },
      { status: 'Paid', currency: 'USD', total_value: 500, procurement_invoices: [{ amount: 500 }], payments: [] },
    ] as never[]);

    expect(result).toEqual({ count: 2, knownTotals: [{ currency: 'USD', amount: 125 }], unknownBalances: 1 });
  });

  it('SEC-RS-2: owed to suppliers is the unpaid supplier invoice balance, as on the Procurement list', () => {
    const result = selectSupplierInvoices([
      { status: 'Vendor Invoiced', currency: 'IDR', total_value: 1000, procurement_invoices: [{ amount: 1110 }], payments: [{ amount: 400, status: 'Paid' }] },
      { status: 'Vendor Invoiced', currency: 'IDR', total_value: 900, procurement_invoices: [], payments: [] },
    ] as never[]);

    expect(result).toEqual({ count: 2, knownTotals: [{ currency: 'IDR', amount: 710 }], unknownBalances: 1 });
  });

  it('AC-UXA-003: in Bahasa the at-risk doorway reads in Bahasa and keeps its raw filter destination (ported)', async () => {
    const i18n = i18next.createInstance();
    await i18n.init({
      lng: 'id', fallbackLng: 'en', defaultNS: 'dashboard', interpolation: { escapeValue: false },
      resources: {
        id: { dashboard: JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/dashboard.json'), 'utf8')) },
        en: { dashboard: JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/dashboard.json'), 'utf8')) },
      },
    });
    const bahasa = (key: string, fallback: string, options?: Record<string, unknown>) => i18n.t(key, { defaultValue: fallback, ...(options ?? {}) });
    const [atRisk] = buildNeedsItems('Executive', { atRiskProjects: 1 }, bahasa);

    expect(atRisk).toMatchObject({ count: 1, href: '/projects?filter=at-risk', label: 'proyek berisiko' });
  });
});
