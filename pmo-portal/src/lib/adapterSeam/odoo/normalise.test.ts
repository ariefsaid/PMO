import { describe, expect, it } from 'vitest';
import { normaliseAccount, normaliseItem, normaliseParty, normaliseProject } from './normalise.ts';

const base = { id: 5, name: 'PT Sinar Baja', vat: '01.234.567.8-901.000', ref: false, is_company: true, parent_id: false, active: true, supplier_rank: 2, customer_rank: 1 };

describe('odoo/normalise — AC-ODC-032, SD-8', () => {
  it('AC-ODC-032 a partner that is both vendor and client yields two normalised rows with distinct external ids', () => {
    const rows = normaliseParty(base);
    expect(rows.map((r) => [r.role, r.externalId])).toEqual([['vendor', 'Vendor:5'], ['client', 'Client:5']]);
    expect(rows[0]).toMatchObject({ kind: 'party', taxId: '01.234.567.8-901.000', code: null, name: 'PT Sinar Baja', active: true, internal: false });
  });
  it('a child contact is excluded (FR-ODC-053)', () => expect(normaliseParty({ ...base, is_company: false, parent_id: [9, 'PT X'] })).toEqual([]));
  it('a standalone individual (no parent) is kept', () => expect(normaliseParty({ ...base, is_company: false, customer_rank: 0 })).toHaveLength(1));
  it('zero ranks → one row with no role (the matcher makes it a review row, FR-ODC-052)', () => {
    const [row, ...rest] = normaliseParty({ ...base, supplier_rank: 0, customer_rank: 0 });
    expect(rest).toEqual([]);
    expect(row.role).toBeUndefined();
    expect(row.externalId).toBe('5');
  });
  it('a partner that is a company\'s own partner is marked internal', () =>
    expect(normaliseParty(base, new Set([5])).every((r) => r.internal)).toBe(true));
  it('keeps a PMO-written ref as the code and blanks a false vat', () =>
    expect(normaliseParty({ ...base, ref: 'pmo:c-1', vat: false })[0]).toMatchObject({ code: 'pmo:c-1', taxId: null }));
  it('an archived partner normalises inactive', () => expect(normaliseParty({ ...base, active: false })[0].active).toBe(false));
  it('a project normalises from an analytic account of the chosen plan; code is the account code', () =>
    expect(normaliseProject({ id: 101, name: 'PRJ-26-0001 Jembatan', code: 'PRJ-26-0001', plan_id: [7, 'Projects'], active: true }))
      .toMatchObject({ kind: 'project', externalId: '101', code: 'PRJ-26-0001', active: true }));
  it('an item normalises from product.product; code is default_code', () =>
    expect(normaliseItem({ id: 3, default_code: 'SMN-50', name: 'Semen 50 kg', active: true })).toMatchObject({ kind: 'item', externalId: '3', code: 'SMN-50' }));
  it('an account normalises with its code', () =>
    expect(normaliseAccount({ id: 9, code: '611000', name: 'Beban Gaji', active: true })).toEqual({ kind: 'account', externalId: '9', code: '611000', name: 'Beban Gaji', active: true }));
});
