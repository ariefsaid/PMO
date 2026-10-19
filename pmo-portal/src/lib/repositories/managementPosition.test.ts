import { describe, expect, it } from 'vitest';
import type { ErpAgingSnapshotRow } from '@/src/lib/db/erpSnapshots';
import type { ProjectMoneyRead } from '@/src/lib/db/projectMoney';
import { deriveMargin, type ProjectFinances, type ProjectReceiptCash } from '@/src/lib/projectFinances';
import type { CompanyCollectionsComposition } from '@/src/lib/repositories/companyCollections';
import type { PackRow } from '@/src/lib/reports/managementPack';

async function projectRows(
  rows: readonly PackRow[],
  moneyByProject: Readonly<Record<string, ProjectMoneyRead>>,
  readState: 'loading' | 'success' | 'error',
) {
  const module = await import('./managementPosition').catch(() => null);
  expect(module?.buildManagementPositionRows).toBeTypeOf('function');
  return module!.buildManagementPositionRows(rows, moneyByProject, readState);
}

async function projectDetail(
  row: import('./managementPosition').ManagementPositionRow,
  finances: ProjectFinances,
  project: { id: string; client_id: string | null; currency: string },
  collections: CompanyCollectionsComposition | null,
) {
  const module = await import('./managementPosition');
  expect(module.buildManagementPositionDetail).toBeTypeOf('function');
  return module.buildManagementPositionDetail(row, finances, project, collections);
}

function packRow(projectId: string | null, overrides: Partial<PackRow> = {}): PackRow {
  return {
    key: projectId ?? 'unassigned',
    kind: projectId ? 'contract' : 'unassigned',
    projectId,
    projectName: projectId ? `Project ${projectId}` : null,
    projectNumber: null,
    clientName: null,
    projectManagerId: null,
    projectStatus: 'Ongoing Project',
    currency: 'USD',
    contractNet: 10_000,
    latestProgress: null,
    months: [],
    ...overrides,
  };
}

function money(
  total: string | null,
  overrides: Partial<ProjectMoneyRead['actuals']> = {},
  ledgerBasis: ProjectMoneyRead['ledgerBasis'] = 'pmo',
): ProjectMoneyRead {
  return {
    ledgerBasis,
    actuals: {
      currency: 'USD',
      total,
      asOf: '2026-10-18T08:00:00Z',
      excludesRestrictedRows: false,
      complete: true,
      categories: [],
      ...overrides,
    },
    activeBudgetAmount: null,
    activeBudgetCurrency: null,
    hasActiveBudget: false,
  };
}

describe('management position source projection', () => {
  it('AC-S35-001: unique IDs and honest exact Actual states', async () => {
    const rows = Object.freeze([
      Object.freeze(packRow('p1', { kind: 'otherCurrency', currency: 'EUR', projectName: 'One' })),
      Object.freeze(packRow('p1', { kind: 'contract', projectName: 'One' })),
      Object.freeze(packRow('p2', { projectName: 'Two' })),
      Object.freeze(packRow(null)),
    ]) as unknown as readonly PackRow[];
    const moneyByProject = Object.freeze({
      p1: Object.freeze(money('0.00')),
      p2: Object.freeze(money('-1.00')),
    });
    const before = structuredClone({ rows, moneyByProject });

    const projected = await projectRows(rows, moneyByProject, 'success');

    expect(projected.map((row) => [row.projectId, row.projectName])).toEqual([
      ['p1', 'One'],
      ['p2', 'Two'],
    ]);
    expect(projected.map((row) => row.actual)).toMatchObject([
      { state: 'known', amount: '0.00', currency: 'USD', basis: 'pmo', complete: true, asOf: '2026-10-18T08:00:00Z' },
      { state: 'known', amount: '-1.00', currency: 'USD', basis: 'pmo', complete: true, asOf: '2026-10-18T08:00:00Z' },
    ]);
    expect({ rows, moneyByProject }).toEqual(before);
  });

  it.each([
    ['missing entry', {}, 'unavailable', null],
    ['null amount', { p1: money(null) }, 'unavailable', null],
    ['malformed amount', { p1: money('NaN') }, 'unavailable', null],
    ['malformed currency', { p1: money('2.00', { currency: 'usd' }) }, 'unavailable', null],
    ['partial ERP coverage', { p1: money('2.00', { complete: false }, 'erp') }, 'partial', '2.00'],
    ['restricted rows', { p1: money('2.00', { excludesRestrictedRows: true }) }, 'partial', '2.00'],
  ] as const)('AC-S35-001: %s stays %s without inventing an amount', async (_label, reading, state, amount) => {
    const [project] = await projectRows([packRow('p1')], reading, 'success');

    expect(project.actual).toMatchObject({ state, amount });
  });

  it('AC-S35-001: loading and failed reads remain separate from a known zero', async () => {
    const rows = [packRow('p1')];

    expect((await projectRows(rows, {}, 'loading'))[0].actual)
      .toMatchObject({ state: 'loading', amount: null, basis: 'unavailable' });
    expect((await projectRows(rows, {}, 'error'))[0].actual)
      .toMatchObject({ state: 'error', amount: null, basis: 'unavailable' });
    expect((await projectRows(rows, { p1: money('9007199254740993.01') }, 'success'))[0].actual)
      .toMatchObject({ state: 'known', amount: '9007199254740993.01' });
  });

  it('AC-S35-003: receipt cash and customer aging retain source scope', async () => {
    const row = (await projectRows([packRow('p1')], { p1: money('50.00') }, 'success'))[0];
    const aging: ErpAgingSnapshotRow = {
      party: 'Customer:C-0001', partyType: 'Customer', currency: 'USD', totalOutstanding: 200,
      current: null, bucket0to30: 0, bucket31to60: null, bucket61to90: null, bucketOver90: null,
      rangeLabels: { b_0_30: 'ERP supplied window' }, reportDate: '2026-10-18', ageingBasedOn: 'Due Date',
      asOf: '2026-10-18T00:00:00Z', sourceReport: 'Accounts Receivable', reportVersion: '1', snapshotId: 'snap-1',
    };
    const collections: CompanyCollectionsComposition = { state: 'known', positions: [aging] };
    const finances: ProjectFinances = {
      project_id: 'p1', cash_received: { state: 'known', buckets: [{ currency: 'USD', amount: '1000.00' }], receipt_count: 1 },
      contract_invoiced: '1110.00', remaining_to_invoice: null,
      invoices: [{ currency: 'USD', invoice_count: 1, invoiced: '1110.00', settled: '1110.00', outstanding: '200.00',
        missing_amount: 0, missing_outstanding: 0, tax_basis: 'exclusive', work_revenue: '1200.00', missing_work: 0 }],
      budget: null,
      actuals: { currency: 'USD', as_of: '2026-10-18T08:00:00Z', total: '50.00', excludes_restricted_rows: false, categories: [] },
    };
    const before = structuredClone({ aging, collections, finances });

    const detail = await projectDetail(row, finances, { id: 'p1', client_id: 'c1', currency: 'USD' }, collections);

    expect(detail.cash).toEqual(finances.cash_received);
    expect(detail.billedWork).toEqual([{ currency: 'USD', work_revenue: '1200.00', missing_work: 0 }]);
    expect(detail.projectOutstanding).toEqual([{
      currency: 'USD', outstanding: '200.00', missing_outstanding: 0, tax_basis: 'exclusive',
    }]);
    expect(detail.collections).toBe(collections);
    expect(detail.collections?.positions[0]).toEqual(aging);
    expect({ aging, collections, finances }).toEqual(before);
  });

  it('AC-S35-002: PMO-ledger committed cost never yields a billed-work margin', async () => {
    const row = (await projectRows([packRow('p1')], { p1: money('50.00') }, 'success'))[0];
    const finances: ProjectFinances = {
      project_id: 'p1', contract_invoiced: null, remaining_to_invoice: null,
      invoices: [
        { currency: 'USD', invoice_count: 1, invoiced: '100.00', settled: null, outstanding: null,
          missing_amount: 0, missing_outstanding: 0, tax_basis: 'exclusive', work_revenue: '100.00', missing_work: 0 },
        { currency: 'EUR', invoice_count: 1, invoiced: '100.00', settled: null, outstanding: null,
          missing_amount: 0, missing_outstanding: 0, tax_basis: 'exclusive', work_revenue: '100.00', missing_work: 0 },
      ],
      budget: null,
      actuals: { currency: 'USD', as_of: null, total: '50.00', excludes_restricted_rows: false,
        categories: [{ category: 'Labor', mapped: true, amount: '50.00' }] },
    };

    const detail = await projectDetail(row, finances, { id: 'p1', client_id: null, currency: 'USD' }, null);

    expect(detail.margins).toEqual([
      { currency: 'USD', value: { amount: null, reason: 'actuals-unavailable' } },
      { currency: 'EUR', value: { amount: null, reason: 'different-currencies' } },
    ]);
  });

  it('AC-S35-002: an ERP project with an unmapped category withholds margin exactly as the project page does', async () => {
    const categories = [
      { category: 'Labor', mapped: true, amount: '30.00' },
      { category: 'Materials', mapped: false, amount: null },
    ];
    const row = (await projectRows([packRow('p1')], {
      p1: money('30.00', { complete: true, categories }, 'erp'),
    }, 'success'))[0];
    const finances: ProjectFinances = {
      project_id: 'p1', contract_invoiced: null, remaining_to_invoice: null,
      invoices: [{ currency: 'USD', invoice_count: 1, invoiced: '100.00', settled: null, outstanding: null,
        missing_amount: 0, missing_outstanding: 0, tax_basis: 'exclusive', work_revenue: '100.00', missing_work: 0 }],
      budget: null,
      actuals: { currency: 'USD', as_of: '2026-10-18T08:00:00Z', total: '30.00', excludes_restricted_rows: false, categories },
    };

    const detail = await projectDetail(row, finances, { id: 'p1', client_id: null, currency: 'USD' }, null);

    expect(detail.margins).toEqual([{ currency: 'USD', value: { amount: null, reason: 'actuals-unavailable' } }]);
    expect(detail.margins[0].value).toEqual(deriveMargin(finances.invoices[0], finances.actuals));
  });

  it('AC-S35-002: a fully complete ERP project shows the same margin as the project page', async () => {
    const categories = [
      { category: 'Labor', mapped: true, amount: '30.00' },
      { category: 'Materials', mapped: true, amount: '20.00' },
    ];
    const row = (await projectRows([packRow('p1')], {
      p1: money('50.00', { complete: true, categories }, 'erp'),
    }, 'success'))[0];
    const finances: ProjectFinances = {
      project_id: 'p1', contract_invoiced: null, remaining_to_invoice: null,
      invoices: [{ currency: 'USD', invoice_count: 1, invoiced: '100.00', settled: null, outstanding: null,
        missing_amount: 0, missing_outstanding: 0, tax_basis: 'exclusive', work_revenue: '100.00', missing_work: 0 }],
      budget: null,
      actuals: { currency: 'USD', as_of: '2026-10-18T08:00:00Z', total: '50.00', excludes_restricted_rows: false, categories },
    };

    const detail = await projectDetail(row, finances, { id: 'p1', client_id: null, currency: 'USD' }, null);

    expect(detail.margins).toEqual([{ currency: 'USD', value: { amount: '50.00', reason: null } }]);
    expect(detail.margins[0].value).toEqual(deriveMargin(finances.invoices[0], finances.actuals));
  });

  it('AC-S35-002: a canonical ERP reading that is not complete withholds margin even when every category maps', async () => {
    const categories = [{ category: 'Labor', mapped: true, amount: '50.00' }];
    const row = (await projectRows([packRow('p1')], {
      p1: money('50.00', { complete: false, categories }, 'erp'),
    }, 'success'))[0];
    const finances: ProjectFinances = {
      project_id: 'p1', contract_invoiced: null, remaining_to_invoice: null,
      invoices: [{ currency: 'USD', invoice_count: 1, invoiced: '100.00', settled: null, outstanding: null,
        missing_amount: 0, missing_outstanding: 0, tax_basis: 'exclusive', work_revenue: '100.00', missing_work: 0 }],
      budget: null,
      actuals: { currency: 'USD', as_of: '2026-10-18T08:00:00Z', total: '50.00', excludes_restricted_rows: false, categories },
    };

    const detail = await projectDetail(row, finances, { id: 'p1', client_id: null, currency: 'USD' }, null);

    expect(detail.margins).toEqual([{ currency: 'USD', value: { amount: null, reason: 'actuals-unavailable' } }]);
  });

  it.each([
    ['total', { total: '51.00' }],
    ['currency', { currency: 'EUR' }],
    ['source time', { as_of: '2026-10-19T08:00:00Z' }],
    ['restricted-row status', { excludes_restricted_rows: true }],
  ] as const)('AC-S35-003: ERP Actual %s disagreement withholds margin but keeps cash and customer aging', async (_field, override) => {
    const row = (await projectRows([packRow('p1')], {
      p1: money('50.00', {}, 'erp'),
    }, 'success'))[0];
    const cash: ProjectReceiptCash = { state: 'known', buckets: [{ currency: 'USD', amount: '10.00' }], receipt_count: 1 };
    const collections: CompanyCollectionsComposition = { state: 'known', positions: [] };
    const finances: ProjectFinances = {
      project_id: 'p1', cash_received: cash, contract_invoiced: null, remaining_to_invoice: null,
      invoices: [{ currency: 'USD', invoice_count: 1, invoiced: '100.00', settled: null, outstanding: null,
        missing_amount: 0, missing_outstanding: 0, tax_basis: 'exclusive', work_revenue: '100.00', missing_work: 0 }],
      budget: null,
      actuals: {
        currency: 'USD', as_of: '2026-10-18T08:00:00Z', total: '50.00',
        excludes_restricted_rows: false, categories: [], ...override,
      },
    };

    const detail = await projectDetail(row, finances, { id: 'p1', client_id: 'c1', currency: 'USD' }, collections);

    expect(detail).toMatchObject({
      limitation: 'actuals-changed',
      margins: [{ currency: 'USD', value: { amount: null, reason: 'actuals-unavailable' } }],
      cash,
      collections,
    });
  });

  it('AC-S35-003: ERP exact amounts with equivalent decimal scale remain comparable', async () => {
    const categories = [{ category: 'Labor', mapped: true, amount: '50.00' }];
    const row = (await projectRows([packRow('p1')], {
      p1: money('50.00', { categories }, 'erp'),
    }, 'success'))[0];
    const finances: ProjectFinances = {
      project_id: 'p1', contract_invoiced: null, remaining_to_invoice: null,
      invoices: [{ currency: 'USD', invoice_count: 1, invoiced: '100.00', settled: null, outstanding: null,
        missing_amount: 0, missing_outstanding: 0, tax_basis: 'exclusive', work_revenue: '100.00', missing_work: 0 }],
      budget: null,
      actuals: { currency: 'USD', as_of: '2026-10-18T08:00:00Z', total: '50', excludes_restricted_rows: false, categories },
    };

    const detail = await projectDetail(row, finances, { id: 'p1', client_id: null, currency: 'USD' }, null);

    expect(detail).toMatchObject({
      limitation: null,
      margins: [{ currency: 'USD', value: { amount: '50.00', reason: null } }],
    });
  });

  it.each([
    ['known zero', { state: 'known', buckets: [], receipt_count: 0 }, { state: 'known', buckets: [], receipt_count: 0 }],
    ['incomplete', { state: 'incomplete', buckets: [], receipt_count: 2, reasons: ['allocation-unreported'] },
      { state: 'incomplete', buckets: [], receipt_count: 2, reasons: ['allocation-unreported'] }],
    ['unavailable', { state: 'unavailable', buckets: [], reason: 'invalid-reading' },
      { state: 'unavailable', buckets: [], reason: 'invalid-reading' }],
  ] as const)('AC-S35-003: %s cash remains in its validated union state', async (_name, cash, expected) => {
    const row = (await projectRows([packRow('p1')], { p1: money('0.00') }, 'success'))[0];
    const finances: ProjectFinances = {
      project_id: 'p1', cash_received: cash as unknown as ProjectReceiptCash, contract_invoiced: null, remaining_to_invoice: null,
      invoices: [], budget: null,
      actuals: { currency: 'USD', as_of: null, total: '0.00', excludes_restricted_rows: false, categories: [] },
    };

    const detail = await projectDetail(row, finances, { id: 'p1', client_id: null, currency: 'USD' }, null);

    expect(detail.cash).toEqual(expected);
    expect(detail.projectCurrency).toBe('USD');
    expect(detail.customerId).toBeNull();
    expect(detail.collections).toBeNull();
  });

  it('AC-S35-003: absent cash stays not-reported and project mismatch withholds detail', async () => {
    const row = (await projectRows([packRow('p1')], { p1: money('0.00') }, 'success'))[0];
    const finances: ProjectFinances = {
      project_id: 'different-project', contract_invoiced: null, remaining_to_invoice: null,
      invoices: [], budget: null,
      actuals: { currency: 'USD', as_of: null, total: '0.00', excludes_restricted_rows: false, categories: [] },
    };

    const detail = await projectDetail(row, finances, { id: 'p1', client_id: 'c1', currency: 'USD' }, {
      state: 'known', positions: [],
    });

    expect(detail).toMatchObject({
      projectId: 'p1', limitation: 'project-mismatch',
      cash: { state: 'unavailable', reason: 'invalid-reading' },
      billedWork: [], projectOutstanding: [], customerId: null, collections: null,
    });

    const matching = await projectDetail(row, { ...finances, project_id: 'p1' },
      { id: 'p1', client_id: 'c1', currency: 'USD' }, null);
    expect(matching.cash).toEqual({ state: 'unavailable', buckets: [], reason: 'not-reported' });
  });

  it('AC-S35-003: two projects with one client carry the same customer context without summing it', async () => {
    const rows = await projectRows([packRow('p1'), packRow('p2')], { p1: money('1.00'), p2: money('2.00') }, 'success');
    const shared: CompanyCollectionsComposition = { state: 'known', positions: [{
      party: 'Customer:C-0001', partyType: 'Customer', currency: 'USD', totalOutstanding: 200,
      current: null, bucket0to30: 0, bucket31to60: null, bucket61to90: null, bucketOver90: null,
      rangeLabels: {}, reportDate: '2026-10-18', ageingBasedOn: 'Due Date', asOf: '2026-10-18T00:00:00Z',
      sourceReport: 'Accounts Receivable', reportVersion: '1', snapshotId: 'snap-1',
    }] };
    const finance = (id: string): ProjectFinances => ({
      project_id: id, contract_invoiced: null, remaining_to_invoice: null, invoices: [], budget: null,
      actuals: { currency: 'USD', as_of: null, total: '0.00', excludes_restricted_rows: false, categories: [] },
    });

    const [first, second] = await Promise.all([
      projectDetail(rows[0], finance('p1'), { id: 'p1', client_id: 'c1', currency: 'USD' }, shared),
      projectDetail(rows[1], finance('p2'), { id: 'p2', client_id: 'c1', currency: 'USD' }, shared),
    ]);

    expect(first.customerId).toBe('c1');
    expect(second.customerId).toBe('c1');
    expect(first.collections).toBe(shared);
    expect(second.collections).toBe(shared);
    expect(first.collections?.positions).toHaveLength(1);
    expect(second.collections?.positions).toHaveLength(1);
  });
});
