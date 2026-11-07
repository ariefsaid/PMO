import { describe, expect, it } from 'vitest';
import { createErpnextConnectAdapter, ERP_CONNECT_PAGE, erpnextSendProbe } from './connectAdapter.ts';
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

  it('an unknown kind is rejected and a kind that is not sent is refused', async () => {
    const { client } = fakeErp({});
    const a = createErpnextConnectAdapter(client, 'Test Co');
    await expect(a.listMasters('contact', null)).rejects.toThrow(/unavailable/);
    await expect(a.listMasters('party', 'Bogus:x')).rejects.toThrow(/cursor/);
    for (const kind of ['employee', 'account', 'contact'] as const) {
      await expect(a.sendMaster(kind, { id: 'p', name: 'n' }, 'k')).rejects.toMatchObject({ code: 'commit-rejected', message: expect.stringMatching(/unavailable/) });
    }
  });
});

describe('ECA3-T3 erpnext ConnectAdapter sends (lookup-then-create, FR-ECA-020/021)', () => {
  const posts = (seen: Array<{ method: string; path: string }>) => seen.filter((r) => r.method === 'POST');

  it('a vendor becomes a Supplier and a client a Customer; the tax id travels', async () => {
    const tables: Record<string, Array<Record<string, unknown>>> = {};
    const { client } = fakeErp(tables);
    const a = createErpnextConnectAdapter(client, 'Test Co');
    expect(await a.sendMaster('party', { id: 'c1', name: 'PT Baja', role: 'vendor', taxId: '01.234' }, 'seed:party:c1')).toEqual({ externalId: 'Supplier:SUP-1' });
    expect(await a.sendMaster('party', { id: 'c2', name: 'PT Klien', role: 'client' }, 'seed:party:c2')).toEqual({ externalId: 'Customer:CUS-1' });
    expect(tables.Supplier[0]).toMatchObject({ supplier_name: 'PT Baja', tax_id: '01.234', supplier_group: 'Services' });
    expect(tables.Customer[0]).toMatchObject({ customer_name: 'PT Klien', customer_group: 'Commercial' });
  });

  it('looks the master up before any create: a name already in the ERP is linked, not created again', async () => {
    const { client, seen } = fakeErp({ Supplier: [{ name: 'SUP-9', supplier_name: 'PT Baja', tax_id: '01.234' }] });
    const a = createErpnextConnectAdapter(client, 'Test Co');
    expect(await a.sendMaster('party', { id: 'c1', name: 'PT Baja', role: 'vendor', taxId: '01.234' }, 'seed:party:c1')).toEqual({ externalId: 'Supplier:SUP-9' });
    expect(posts(seen)).toHaveLength(0);
  });

  it('a project is created in the connected company, an item under its code with the purchase flags', async () => {
    const tables: Record<string, Array<Record<string, unknown>>> = {};
    const { client } = fakeErp(tables);
    const a = createErpnextConnectAdapter(client, 'Test Co');
    expect(await a.sendMaster('project', { id: 'p1', name: 'Jembatan', code: 'PRJ-1' }, 'seed:project:p1')).toEqual({ externalId: 'PROJ-1' });
    expect(tables.Project[0]).toMatchObject({ project_name: 'Jembatan', company: 'Test Co' });
    expect(await a.sendMaster('item', { id: 'Semen 50 kg', name: 'Semen 50 kg', code: 'Semen 50 kg' }, 'seed:item:Semen 50 kg')).toEqual({ externalId: 'Semen 50 kg' });
    expect(tables.Item[0]).toMatchObject({ item_code: 'Semen 50 kg', item_name: 'Semen 50 kg', is_purchase_item: 1, is_stock_item: 0 });
  });

  it('a project of another company with the same name is not ours: the lookup is company-scoped', async () => {
    const { client, seen } = fakeErp({ Project: [{ name: 'PROJ-7', project_name: 'Jembatan', company: 'Other Co' }] });
    const a = createErpnextConnectAdapter(client, 'Test Co');
    const sent = await a.sendMaster('project', { id: 'p1', name: 'Jembatan' }, 'k');
    expect(sent.externalId).not.toBe('PROJ-7');
    expect(posts(seen)).toHaveLength(1);
  });

  it('an item keyed differently in the ERP is found by its name instead of duplicated (FR-ECA-016)', async () => {
    const { client, seen } = fakeErp({ Item: [{ name: 'ITM-0001', item_code: 'ITM-0001', item_name: 'Kabel 10 mm' }] });
    const a = createErpnextConnectAdapter(client, 'Test Co');
    expect(await a.sendMaster('item', { id: 'Kabel 10 mm', name: 'Kabel 10 mm', code: 'Kabel 10 mm' }, 'k')).toEqual({ externalId: 'ITM-0001' });
    expect(posts(seen)).toHaveLength(0);
  });

  it('a create past the outbox claim\'s deadline is refused before it reaches the ERP (nothing is created, the lookup still ran)', async () => {
    const { client, seen } = fakeErp({});
    const a = createErpnextConnectAdapter(client, 'Test Co');
    await expect(a.sendMaster('party', { id: 'c1', name: 'PT Baja', role: 'vendor' }, 'k', { commitDeadlineAtMs: Date.now() - 1 })).rejects.toMatchObject({ code: 'external-unreachable' });
    expect(posts(seen)).toHaveLength(0);
    expect(seen.filter((r) => r.method === 'GET' && r.path.startsWith('/api/resource/Supplier?'))).toHaveLength(1);
  });

  it('two ERP records that match one send are refused as ambiguous, nothing is created', async () => {
    const { client, seen } = fakeErp({ Project: [
      { name: 'PROJ-1', project_name: 'Jembatan', company: 'Test Co' }, { name: 'PROJ-2', project_name: 'Jembatan', company: 'Test Co' },
    ] });
    const a = createErpnextConnectAdapter(client, 'Test Co');
    await expect(a.sendMaster('project', { id: 'p1', name: 'Jembatan' }, 'k')).rejects.toMatchObject({ code: 'commit-rejected', message: 'Two ERP records match this record' });
    expect(posts(seen)).toHaveLength(0);
  });

  it('the recovery probe runs the same lookup: an id when the ERP holds it, null when not, ambiguous when two do', async () => {
    const { client } = fakeErp({ Item: [{ name: 'SMN', item_code: 'SMN', item_name: 'Semen' }], Project: [
      { name: 'PROJ-1', project_name: 'Dup', company: 'Test Co' }, { name: 'PROJ-2', project_name: 'Dup', company: 'Test Co' },
    ] });
    expect(await erpnextSendProbe(client, 'Test Co', 'item', { id: 'Semen', name: 'Semen', code: 'SMN' })).toEqual({ externalRecordId: 'SMN' });
    expect(await erpnextSendProbe(client, 'Test Co', 'item', { id: 'Beton', name: 'Beton', code: 'BTN' })).toBeNull();
    await expect(erpnextSendProbe(client, 'Test Co', 'project', { id: 'p', name: 'Dup' })).rejects.toMatchObject({ code: 'commit-rejected' });
  });

  it('I3 the lookup before a create is one bounded attempt: a failing ERP is not retried into the claim budget', async () => {
    let gets = 0;
    const client = { fetchImpl: (async () => { gets += 1; return new Response('down', { status: 503 }); }) as typeof fetch, baseUrl: 'https://erp.example.test',
      apiKey: 'k', apiSecret: 's', maxRetries: 3, sleep: async () => {} };
    await expect(createErpnextConnectAdapter(client, 'Test Co').sendMaster('project', { id: 'p', name: 'Jembatan' }, 'k')).rejects.toMatchObject({ code: 'external-unreachable' });
    expect(gets).toBe(1);
  });
});

describe('#1606 sends file under the ERP\'s default non-group group, never a hard-coded root node', () => {
  const vendor = { id: 'c1', name: 'PT Baja', role: 'vendor' as const };
  const client_ = { id: 'c2', name: 'PT Klien', role: 'client' as const };
  const item = { id: 'Semen', name: 'Semen', code: 'Semen' };

  it('uses the configured default of each settings doctype', async () => {
    const tables: Record<string, Array<Record<string, unknown>>> = {
      'Selling Settings': [{ name: 'Selling Settings', customer_group: 'Retail' }], 'Buying Settings': [{ name: 'Buying Settings', supplier_group: 'Local' }],
      'Stock Settings': [{ name: 'Stock Settings', item_group: 'Raw' }],
      'Customer Group': [{ name: 'Retail', is_group: 0 }], 'Supplier Group': [{ name: 'Local', is_group: 0 }], 'Item Group': [{ name: 'Raw', is_group: 0 }],
    };
    const a = createErpnextConnectAdapter(fakeErp(tables).client, 'Test Co');
    await a.sendMaster('party', vendor, 'k1'); await a.sendMaster('party', client_, 'k2'); await a.sendMaster('item', item, 'k3');
    expect(tables.Supplier[0].supplier_group).toBe('Local');
    expect(tables.Customer[0].customer_group).toBe('Retail');
    expect(tables.Item[0].item_group).toBe('Raw');
  });

  it('falls back to the first non-group when no default is set', async () => {
    const tables: Record<string, Array<Record<string, unknown>>> = {
      'Customer Group': [{ name: 'All Customer Groups', is_group: 1 }, { name: 'Zeta', is_group: 0 }, { name: 'Alpha', is_group: 0 }],
    };
    await createErpnextConnectAdapter(fakeErp(tables).client, 'Test Co').sendMaster('party', client_, 'k');
    expect(tables.Customer[0].customer_group).toBe('Alpha');
  });

  it('a default that is itself a group node is passed over for the first non-group', async () => {
    const tables: Record<string, Array<Record<string, unknown>>> = { 'Selling Settings': [{ name: 'Selling Settings', customer_group: 'All Customer Groups' }] };
    await createErpnextConnectAdapter(fakeErp(tables).client, 'Test Co').sendMaster('party', client_, 'k');
    expect(tables.Customer[0].customer_group).toBe('Commercial');
  });

  it('reads each default once per adapter, not once per send', async () => {
    const { client, seen } = fakeErp({});
    const a = createErpnextConnectAdapter(client, 'Test Co');
    await a.sendMaster('party', { ...client_, id: 'a', name: 'A' }, 'k1'); await a.sendMaster('party', { ...client_, id: 'b', name: 'B' }, 'k2');
    expect(seen.filter((r) => r.path.includes('Selling%20Settings'))).toHaveLength(1);
    expect(seen.filter((r) => r.path.startsWith('/api/resource/Customer%20Group'))).toHaveLength(1);
  });

  it('with no non-group at all the send fails with a clear refusal and creates nothing', async () => {
    const tables: Record<string, Array<Record<string, unknown>>> = { 'Customer Group': [{ name: 'All Customer Groups', is_group: 1 }] };
    const { client, seen } = fakeErp(tables);
    await expect(createErpnextConnectAdapter(client, 'Test Co').sendMaster('party', client_, 'k')).rejects
      .toMatchObject({ code: 'commit-rejected', message: expect.stringMatching(/non-group Customer Group/i) });
    expect(seen.filter((r) => r.method === 'POST')).toHaveLength(0);
  });

  it('the fake refuses a group node like the real ERP (guards the guard)', async () => {
    const { client } = fakeErp({});
    const res = await client.fetchImpl('https://erp.test/api/resource/Customer', { method: 'POST', body: JSON.stringify({ customer_name: 'x', customer_group: 'All Customer Groups' }) });
    expect(res.status).toBe(417);
  });
});

describe('#1692 which PMO field ERPNext matches its project code on', () => {
  it('an ERPNext project is named by the client project code, so it matches PMO\'s `code`', () => {
    const { client } = fakeErp({});
    expect(createErpnextConnectAdapter(client, 'Test Co').projectCodeField).toBe('code');
  });
});
