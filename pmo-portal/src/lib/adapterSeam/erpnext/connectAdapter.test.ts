import { describe, expect, it } from 'vitest';
import { createErpnextConnectAdapter, ERP_CONNECT_PAGE } from './connectAdapter.ts';
import { fakeErp } from './fakeErp.ts';

describe('ECA2-T7 erpnext ConnectAdapter reads', () => {
  it('lists parties: Supplier first, then Customer, normalised, then done', async () => {
    const { client } = fakeErp({
      Supplier: [{ name: 'SUP-1', supplier_name: 'Acme', tax_id: '01', disabled: 0, is_internal_supplier: 0 }, { name: 'SUP-2', supplier_name: 'Own', disabled: 1, is_internal_supplier: 1 }],
      Customer: [{ name: 'CUS-1', customer_name: 'Beta', tax_id: null, disabled: 0, is_internal_customer: 0 }],
    });
    const a = createErpnextConnectAdapter(client, 'Test Co');
    const p1 = await a.listMasters('party', null);
    expect(p1.rows).toEqual([
      { kind: 'party', externalId: 'Supplier:SUP-1', role: 'vendor', taxId: '01', name: 'Acme', active: true, internal: false },
      { kind: 'party', externalId: 'Supplier:SUP-2', role: 'vendor', taxId: null, name: 'Own', active: false, internal: true },
    ]);
    expect(p1.nextCursor).toBe('Customer:');
    const p2 = await a.listMasters('party', p1.nextCursor);
    expect(p2.rows).toEqual([{ kind: 'party', externalId: 'Customer:CUS-1', role: 'client', taxId: null, name: 'Beta', active: true, internal: false }]);
    expect(p2.nextCursor).toBeNull();
  });

  it('a full page continues from the last name of the same doctype', async () => {
    const rows = Array.from({ length: ERP_CONNECT_PAGE + 1 }, (_, i) => ({ name: `ITEM-${String(i).padStart(4, '0')}`, item_name: `Item ${i}`, disabled: 0 }));
    const { client } = fakeErp({ Item: rows });
    const a = createErpnextConnectAdapter(client, 'Test Co');
    const p1 = await a.listMasters('item', null);
    expect(p1.rows).toHaveLength(ERP_CONNECT_PAGE);
    expect(p1.nextCursor).toBe(`Item:ITEM-${String(ERP_CONNECT_PAGE - 1).padStart(4, '0')}`);
    const p2 = await a.listMasters('item', p1.nextCursor);
    expect(p2.rows.map((r) => r.externalId)).toEqual([`ITEM-${String(ERP_CONNECT_PAGE).padStart(4, '0')}`]);
    expect(p2.nextCursor).toBeNull();
  });

  it('an employee with an empty company email takes its login as the match code', async () => {
    const { client } = fakeErp({ Employee: [{ name: 'HR-EMP-2', employee_name: 'Budi', company_email: '', user_id: 'Budi@Example.com', status: 'Active', company: 'Test Co' }] });
    const rows = (await createErpnextConnectAdapter(client, 'Test Co').listMasters('employee', null)).rows;
    expect(rows[0].code).toBe('budi@example.com');
  });

  it('maps project, employee and account; only company-owned doctypes are filtered by company', async () => {
    const { client, seen } = fakeErp({
      Project: [{ name: 'PROJ-1', project_name: 'Bridge', status: 'Open', company: 'Test Co' }, { name: 'PROJ-2', project_name: 'Other', status: 'Open', company: 'Other Co' }],
      Employee: [{ name: 'HR-EMP-1', employee_name: 'Siti', company_email: 'Siti@Example.com', user_id: null, status: 'Active', company: 'Test Co' }],
      Account: [{ name: '5100 - Labor - TC', account_name: 'Labor', account_number: '5100', parent_account: 'Cost of Sales - TC', root_type: 'Expense', is_group: 0, disabled: 0, company: 'Test Co' }],
    });
    const a = createErpnextConnectAdapter(client, 'Test Co');
    expect((await a.listMasters('project', null)).rows).toEqual([{ kind: 'project', externalId: 'PROJ-1', code: 'PROJ-1', name: 'Bridge', active: true }]);
    expect((await a.listMasters('employee', null)).rows).toEqual([{ kind: 'employee', externalId: 'HR-EMP-1', code: 'siti@example.com', name: 'Siti', active: true }]);
    expect((await a.listMasters('account', null)).rows).toEqual([{ kind: 'account', externalId: '5100 - Labor - TC', code: 'Labor', name: 'Labor', active: true }]);
    expect(seen).toHaveLength(3);
    for (const r of seen) expect(r.filters).toContainEqual(['company', '=', 'Test Co']);
    const plain = fakeErp({ Item: [{ name: 'I', item_name: 'I', disabled: 0 }] });
    await createErpnextConnectAdapter(plain.client, 'Test Co').listMasters('item', null);
    expect(plain.seen[0].filters).toEqual([]);
  });

  it('counts masters and submitted money documents with GETs only', async () => {
    const { client, seen } = fakeErp({
      Supplier: [{ name: 'S1' }, { name: 'S2' }], Customer: [{ name: 'C1' }],
      'Purchase Order': [{ name: 'PO1', company: 'Test Co', docstatus: 1 }, { name: 'PO2', company: 'Test Co', docstatus: 0 }],
      'Purchase Receipt': [{ name: 'PR1', company: 'Test Co', docstatus: 1 }],
      'Payment Entry': [{ name: 'PE1', company: 'Test Co', docstatus: 1, payment_type: 'Receive' }, { name: 'PE2', company: 'Test Co', docstatus: 1, payment_type: 'Pay' }, { name: 'PE3', company: 'Test Co', docstatus: 1, payment_type: 'Pay' }],
    });
    const a = createErpnextConnectAdapter(client, 'Test Co');
    expect(await a.countDomain('party')).toBe(3);
    expect(await a.countDomain('purchase')).toBe(2);
    expect(await a.countDomain('receipt')).toBe(1);
    expect(await a.countDomain('payment')).toBe(2);
    expect(await a.countDomain('timesheet')).toBe(0);
    expect(seen.every((r) => r.method === 'GET')).toBe(true);
  });

  it('an unknown kind is rejected and sending is unavailable until ECA-3', async () => {
    const { client } = fakeErp({});
    const a = createErpnextConnectAdapter(client, 'Test Co');
    await expect(a.listMasters('contact', null)).rejects.toThrow(/unavailable/);
    await expect(a.listMasters('party', 'Bogus:x')).rejects.toThrow(/cursor/);
    await expect(a.sendMaster('party', { id: 'p', name: 'n' }, 'k')).rejects.toThrow(/unavailable/);
  });
});
