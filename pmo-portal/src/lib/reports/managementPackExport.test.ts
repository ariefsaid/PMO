import { describe, it, expect } from 'vitest';
import { buildManagementPack } from './managementPack';
import { buildManagementPackExport, managementPackFileStem, type ManagementPackExportLabels } from './managementPackExport';
import type { ManagementPackFacts } from '@/src/lib/db/managementPack';

const labels: ManagementPackExportLabels = {
  month: 'Month', projectNumber: 'Project number', project: 'Project', client: 'Client', currency: 'Currency',
  taxBasis: 'Tax basis', planned: 'Planned', recognised: 'Recognised', invoiced: 'Invoiced',
  recognisedToDate: 'Recognised to date', invoicedToDate: 'Invoiced to date', unbilled: 'Unbilled',
  backlog: 'Backlog', basis: 'Basis', taxBasisValue: 'excl. PPN', unassigned: 'Unassigned', total: 'Total',
  basisInvoiced: 'Invoiced', basisProgress: 'Progress',
};

const facts: ManagementPackFacts = {
  from: '2026-01-01', to: '2026-02-01', timezone: 'Asia/Jakarta', org_currency: 'IDR', undated_invoice_count: 0,
  projects: [{
    id: 'p1', name: 'Alpha', pmo_project_number: 'PRJ-26-0001', code: null, status: 'Ongoing Project',
    currency: 'IDR', contract_net: 1_000, start_date: null, end_date: null, project_manager_id: null, client_name: 'Client A',
  }],
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

  it('AC-MMP-011: one row per pack row per month, then a total row per currency per month', () => {
    expect(table.body).toHaveLength(2 * 2 + 1 * 2);
    expect(table.body.at(-1)![col('Project')]).toBe('Total');
  });

  it('AC-MMP-011: every row carries its currency and the tax basis; money cells are numbers', () => {
    for (const r of table.body) {
      expect(r[col('Currency')]).toBe('IDR');
      expect(r[col('Tax basis')]).toBe('excl. PPN');
    }
    const feb = table.body[1];
    expect(feb[col('Month')]).toBe('2026-02');
    expect(feb[col('Project number')]).toBe('PRJ-26-0001');
    expect(feb[col('Recognised to date')]).toBe(500);
    expect(feb[col('Invoiced to date')]).toBe(100.5);
    expect(feb[col('Unbilled')]).toBe(399.5);
    expect(feb[col('Backlog')]).toBe(500);
    expect(feb[col('Basis')]).toBe('Progress');
    expect(feb[col('Planned')]).toBe('');
    expect(table.body[3][col('Project')]).toBe('Unassigned');
  });

  it('RF-036: an unreconciled cross-currency backlog exports as blank, not a contract-sized debt', () => {
    const packWithForeignBilling = buildManagementPack({
      ...facts,
      invoiced: [...facts.invoiced, { project_id: 'p1', currency: 'USD', month: '2026-02-01', net: 5, invoice_count: 1 }],
    });
    const exported = buildManagementPackExport(packWithForeignBilling, labels);
    const backlog = exported.header.indexOf('Backlog');
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
    const backlog = exported.header.indexOf('Backlog');
    const invoicedToDate = exported.header.indexOf('Invoiced to date');
    const contractRows = exported.body.filter((row) => row[projectNumber] === 'PRJ-26-0001' && row[currency] === 'IDR');
    const idrTotals = exported.body.filter((row) => row[project] === 'Total' && row[currency] === 'IDR');
    expect(contractRows.map((row) => row[backlog])).toEqual(['', '']);
    expect(idrTotals.map((row) => row[backlog])).toEqual(['', '']);
    expect(contractRows[1][invoicedToDate]).toBe(100.5);
  });

  it('AC-MMP-011: the file name carries the as-at month', () => {
    expect(managementPackFileStem(pack)).toBe('Management-pack_2026-02');
  });
});
