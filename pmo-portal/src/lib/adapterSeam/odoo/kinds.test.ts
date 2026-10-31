import { describe, expect, it } from 'vitest';
import { O1_MODELS } from './discovery.ts';
import { companyDomain, DIRECTORY_KINDS, KIND_SPECS, parsePage, type DirectoryKind } from './kinds.ts';

const W = '2026-10-31 10:00:00';
const FIXTURES: Record<DirectoryKind, { raw: Record<string, unknown>; row: Record<string, unknown> }> = {
  company: { raw: { id: 1, name: 'Contoh Konstruksi', currency_id: [12, 'IDR'], write_date: W },
    row: { external_id: '1', code: null, name: 'Contoh Konstruksi', parent_external_id: null, active: true, attrs: { currency: '12' } } },
  partner: { raw: { id: 5, name: 'PT Sinar Baja', vat: '01.234', ref: 'V-1', is_company: true, parent_id: false, active: true, supplier_rank: 2, customer_rank: 0, write_date: W },
    row: { external_id: '5', code: 'V-1', name: 'PT Sinar Baja', parent_external_id: null, active: true, attrs: { vat: '01.234', is_company: true, supplier_rank: 2, customer_rank: 0 } } },
  product: { raw: { id: 7, default_code: 'SEM-50', name: 'Semen 50kg', uom_id: [3, 'Sak'], purchase_ok: true, sale_ok: false, is_storable: true, active: false, write_date: W },
    row: { external_id: '7', code: 'SEM-50', name: 'Semen 50kg', parent_external_id: null, active: false, attrs: { uom_id: '3', purchasable: true, sellable: false, storable: true } } },
  uom: { raw: { id: 3, name: 'Sak', relative_factor: 1, relative_uom_id: false, active: true, write_date: W },
    row: { external_id: '3', code: null, name: 'Sak', parent_external_id: null, active: true, attrs: { relative_factor: 1 } } },
  warehouse: { raw: { id: 2, name: 'Gudang Utama', code: 'WH', lot_stock_id: [8, 'WH/Stock'], view_location_id: [7, 'WH'], active: true, write_date: W },
    row: { external_id: '2', code: 'WH', name: 'Gudang Utama', parent_external_id: null, active: true, attrs: { stock_location_id: '8', view_location_id: '7' } } },
  location: { raw: { id: 8, complete_name: 'WH/Stock', usage: 'internal', location_id: [7, 'WH'], warehouse_id: [2, 'Gudang Utama'], active: true, write_date: W },
    row: { external_id: '8', code: null, name: 'WH/Stock', parent_external_id: '7', active: true, attrs: { usage: 'internal', warehouse_id: '2' } } },
  account: { raw: { id: 40, code: '211000', name: 'Hutang Usaha', account_type: 'liability_payable', active: true, write_date: W },
    row: { external_id: '40', code: '211000', name: 'Hutang Usaha', parent_external_id: null, active: true, attrs: { account_type: 'liability_payable' } } },
  tax: { raw: { id: 9, name: 'PPN 12%', amount: 12, type_tax_use: 'purchase', active: true, write_date: W },
    row: { external_id: '9', code: null, name: 'PPN 12%', parent_external_id: null, active: true, attrs: { amount: 12, use: 'purchase' } } },
  analytic_plan: { raw: { id: 4, name: 'Projects', write_date: W },
    row: { external_id: '4', code: null, name: 'Projects', parent_external_id: null, active: true, attrs: {} } },
  analytic_account: { raw: { id: 11, name: 'Gedung A', code: 'PRJ-1', plan_id: [4, 'Projects'], company_id: [1, 'Contoh'], active: true, write_date: W },
    row: { external_id: '11', code: 'PRJ-1', name: 'Gedung A', parent_external_id: '4', active: true, attrs: { company_id: '1' } } },
};

const nameField = (k: DirectoryKind) => (k === 'location' ? 'complete_name' : 'name');
const m2oField: Partial<Record<DirectoryKind, string>> = { company: 'currency_id', product: 'uom_id', location: 'location_id', analytic_account: 'plan_id', warehouse: 'lot_stock_id' };

describe('odoo/kinds — AC-ODC-024', () => {
  it.each(DIRECTORY_KINDS)('AC-ODC-024 a %s fixture row parses to its directory row', (kind) => {
    const { raw, row } = FIXTURES[kind];
    expect(KIND_SPECS[kind].parse(raw)).toEqual({ ...row, source_write_date: W });
  });

  it.each(DIRECTORY_KINDS)('AC-ODC-024 a malformed %s row is rejected whole', (kind) => {
    const { raw } = FIXTURES[kind];
    const parse = KIND_SPECS[kind].parse;
    expect(parse({ ...raw, id: undefined })).toBeNull();
    expect(parse({ ...raw, id: '7' })).toBeNull();
    expect(parse({ ...raw, [nameField(kind)]: 42 })).toBeNull();
    expect(parse({ ...raw, [nameField(kind)]: '' })).toBeNull();
    expect(parse({ ...raw, write_date: '2026/10/31' })).toBeNull();
    expect(parse({ ...raw, write_date: undefined })).toBeNull();
    const m2o = m2oField[kind];
    if (m2o) expect(parse({ ...raw, [m2o]: 'not-a-pair' })).toBeNull();
  });

  it('AC-ODC-024 a unit without a numeric factor and a tax without a numeric rate are rejected', () => {
    expect(KIND_SPECS.uom.parse({ ...FIXTURES.uom.raw, relative_factor: '1' })).toBeNull();
    expect(KIND_SPECS.tax.parse({ ...FIXTURES.tax.raw, amount: null })).toBeNull();
  });

  it('a many2one of false is no parent, never a malformed row', () => {
    expect(KIND_SPECS.location.parse({ ...FIXTURES.location.raw, location_id: false })?.parent_external_id).toBeNull();
  });

  it('AC-ODC-024 parsePage keeps the good rows, counts the skipped ones and writes no partial row', () => {
    const good = FIXTURES.product.raw;
    const page = parsePage(KIND_SPECS.product, [good, { ...good, id: 8, name: null }, null, 'x', { ...good, id: 9 }]);
    expect(page.skipped).toBe(3);
    expect(page.rows.map((r) => r.external_id)).toEqual(['7', '9']);
  });

  it('every field a kind reads or scopes by is one discovery checks, so a missing field degrades the connection instead of failing the sweep', () => {
    for (const kind of DIRECTORY_KINDS) {
      const { model, fields, company } = KIND_SPECS[kind];
      expect(fields).toContain('write_date');
      expect(O1_MODELS[model], model).toEqual(expect.arrayContaining([...fields, ...(company ? [company] : [])]));
    }
  });

  it('scopes a single-company field to the company and shared rows, a company set to the company', () => {
    expect(companyDomain(KIND_SPECS.product, 3)).toEqual([['company_id', 'in', [3, false]]]);
    expect(companyDomain(KIND_SPECS.account, 3)).toEqual([['company_ids', 'in', [3]]]);
    expect(companyDomain(KIND_SPECS.uom, 3)).toEqual([]);
  });
});
