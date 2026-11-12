import { describe, it, expect } from 'vitest';
import { buildManagementPack } from './managementPack';
import { buildManagementPackExport, managementPackFileStem, type ManagementPackExportLabels } from './managementPackExport';
import type { ManagementPackFacts } from '@/src/lib/db/managementPack';

const labels: ManagementPackExportLabels = {
  period: 'Period', projectNumber: 'Project number', project: 'Project', client: 'Client', currency: 'Currency',
  taxBasis: 'Tax basis', planned: 'Planned', recognised: 'Recognised', invoicedByMonth: 'Billed work by month',
  selectedPeriod: 'Billed work in period', opening: 'Opening billed work', selectedPeriodRow: 'Selected period total', openingRow: 'Opening',
  recognisedToDate: 'Recognised to date', invoicedToDate: 'Invoiced to date', unbilled: 'Done, not yet billed',
  backlog: 'Left to bill', basis: 'Basis', taxBasisValue: 'excl. PPN', unassigned: 'Unassigned', total: 'Total',
  basisInvoiced: 'Invoiced', basisProgress: 'Progress', basisEarned: 'Earned value',
};

const contractProject = {
  id: 'p1', name: 'Alpha', short_name: 'North Terminal', pmo_project_number: 'PRJ-26-0001', code: null, status: 'Ongoing Project',
  currency: 'IDR', contract_net: 1_000, start_date: null, end_date: null, project_manager_id: null, client_name: 'Client A',
};

const facts: ManagementPackFacts = {
  from: '2026-01-01', to: '2026-02-01', timezone: 'Asia/Jakarta', org_currency: 'IDR', undated_invoice_count: 0,
  projects: [contractProject],
  invoiced: [
    { project_id: 'p1', currency: 'IDR', month: '2026-01-01', net: 100.5, invoice_count: 1 },
    { project_id: null, currency: 'IDR', month: '2026-02-01', net: 7, invoice_count: 1 },
  ],
  invoiced_before: [],
  progress: [{ project_id: 'p1', month: '2026-02-01', pct_complete: 50, entered_at: '2026-02-28T00:00:00Z', entered_by_name: 'Fin' }],
};

const earlierInvoice = (project_id: string | null, currency: string, net: number, invoice_count: number) =>
  ({ project_id, currency, net, invoice_count });

describe('AC-MMP-011 management pack export', () => {
  const pack = buildManagementPack(facts);
  const table = buildManagementPackExport(pack, labels);
  const col = (name: string) => table.header.indexOf(name);

  it('F9 exports an unknown planned total blank and a known zero as zero', () => {
    const total = table.body.find((row) => row[col('Project')] === 'Total')!;
    expect(total[col('Planned')]).toBe('');
    const scheduled = buildManagementPack({ ...facts, projects: [{ ...contractProject, start_date: '2027-01-01', end_date: '2027-12-31' }] });
    const known = buildManagementPackExport(scheduled, labels);
    const knownTotal = known.body.find((row) => row[col('Project')] === 'Total')!;
    expect(knownTotal[col('Planned')]).toBe(0);
  });

  it('AC-003 #1325: workbook project cells use the contractual name, not the alias', () => {
    expect(table.body[0][col('Project')]).toBe('Alpha');
    expect(table.body[0][col('Project')]).not.toBe('North Terminal');
  });

  it('AC-MMP-011: one row per pack row per month, then a total row per currency per month', () => {
    expect(table.body).toHaveLength(2 * 2 + 1 * 2 + 2);
    expect(table.body.find((row) => row[col('Period')] === '2026-02' && row[col('Project')] === 'Total')).toBeDefined();
  });

  it('AC-MMP-011: every row carries its currency and the tax basis; money cells are numbers', () => {
    for (const r of table.body) {
      expect(r[col('Currency')]).toBe('IDR');
      expect(r[col('Tax basis')]).toBe('excl. PPN');
    }
    const feb = table.body[1];
    expect(feb[col('Period')]).toBe('2026-02');
    expect(feb[col('Project number')]).toBe('PRJ-26-0001');
    expect(feb[col('Recognised to date')]).toBe(500);
    expect(feb[col('Invoiced to date')]).toBe(100.5);
    expect(feb[col('Done, not yet billed')]).toBe(399.5);
    expect(feb[col('Left to bill')]).toBe(899.5);
    expect(feb[col('Basis')]).toBe('Progress');
    expect(feb[col('Planned')]).toBe('');
    expect(table.body[3][col('Project')]).toBe('Unassigned');
    expect(table.body[0][col('Billed work by month')]).toBe(100.5);
  });

  it('S02: monthly billed work has its own column name beside selected-period and cumulative scopes', () => {
    expect(table.header).toContain('Billed work by month');
    expect(table.header).toContain('Billed work in period');
    expect(table.header).toContain('Invoiced to date');
    expect(new Set(table.header).size).toBe(table.header.length);
  });

  it('S02: selected-period and opening export rows carry the report figure values', () => {
    const packWithOpening = buildManagementPack({
      ...facts,
      invoiced_before: [earlierInvoice('p1', 'IDR', 40, 1)],
    });
    const exported = buildManagementPackExport(packWithOpening, labels);
    const column = (name: string) => exported.header.indexOf(name);
    const periodTotal = exported.body.find((row) => row[column('Period')] === 'Selected period total' && row[column('Currency')] === 'IDR');
    const openingTotal = exported.body.find((row) => row[column('Period')] === 'Opening' && row[column('Currency')] === 'IDR');
    expect(periodTotal?.[column('Billed work in period')]).toBe(107.5);
    expect(openingTotal?.[column('Opening billed work')]).toBe(40);
  });

  it('RF-036: an unreconciled cross-currency backlog exports as blank, not a contract-sized debt', () => {
    const packWithForeignBilling = buildManagementPack({
      ...facts,
      invoiced: [...facts.invoiced, { project_id: 'p1', currency: 'USD', month: '2026-02-01', net: 5, invoice_count: 1 }],
    });
    const exported = buildManagementPackExport(packWithForeignBilling, labels);
    const backlog = exported.header.indexOf('Left to bill');
    expect(exported.body[0][backlog]).toBe('');
    expect(exported.body[1][backlog]).toBe('');
  });

  it('AC-MIP-007: earlier zero-net foreign invoice presence exports blank backlog cells and subtotal', () => {
    const packWithEarlierForeignBilling = buildManagementPack({
      ...facts,
      invoiced_before: [earlierInvoice('p1', 'USD', 0, 2)],
    });
    const exported = buildManagementPackExport(packWithEarlierForeignBilling, labels);
    const project = exported.header.indexOf('Project');
    const projectNumber = exported.header.indexOf('Project number');
    const currency = exported.header.indexOf('Currency');
    const period = exported.header.indexOf('Period');
    const backlog = exported.header.indexOf('Left to bill');
    const invoicedToDate = exported.header.indexOf('Invoiced to date');
    const contractRows = exported.body.filter((row) => row[projectNumber] === 'PRJ-26-0001' && row[currency] === 'IDR');
    const idrTotals = exported.body.filter((row) => row[project] === 'Total' && row[currency] === 'IDR' && /^2026-\d{2}$/u.test(String(row[period])));
    expect(contractRows.map((row) => row[backlog])).toEqual(['', '']);
    expect(idrTotals.map((row) => row[backlog])).toEqual(['', '']);
    expect(contractRows[1][invoicedToDate]).toBe(100.5);
  });

  it('AC-831-2: a project billed in two currencies exports each row with its own currency and numeric money, never summed', () => {
    const twoCurrencies = buildManagementPack({
      ...facts,
      invoiced: [...facts.invoiced, { project_id: 'p1', currency: 'USD', month: '2026-02-01', net: 250.5, invoice_count: 1 }],
    });
    const exported = buildManagementPackExport(twoCurrencies, labels);
    const at = (name: string) => exported.header.indexOf(name);
    const feb = exported.body.filter((row) => row[at('Period')] === '2026-02' && row[at('Project number')] === 'PRJ-26-0001');
    const usd = feb.find((row) => row[at('Currency')] === 'USD');
    const idr = feb.find((row) => row[at('Currency')] === 'IDR');
    expect(usd?.[at('Invoiced to date')]).toBe(250.5);
    expect(idr?.[at('Invoiced to date')]).toBe(100.5);
    const totals = exported.body.filter((row) => row[at('Project')] === 'Total' && row[at('Period')] === '2026-02');
    expect(totals.map((row) => row[at('Currency')]).sort()).toEqual(['IDR', 'USD']);
    expect(totals.find((row) => row[at('Currency')] === 'USD')?.[at('Invoiced to date')]).toBe(250.5);
  });

  it('AC-MMP-011: the file name carries the as-at month', () => {
    expect(managementPackFileStem(pack)).toBe('Management-pack_2026-02');
  });
});
