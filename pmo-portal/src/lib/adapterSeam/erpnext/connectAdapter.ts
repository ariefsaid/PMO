import { AdapterError } from '../contract.ts';
import type { CensusDomain, ConnectAdapter, MasterKind, NormalisedMaster } from '../connect/types.ts';
import { erpnextRequest, type ErpClientDeps } from './client.ts';
import { accountCategoryKey } from '../../budget/categoryAccountMap.ts';
export const ERP_CONNECT_PAGE = 200;
const SPECS: Partial<Record<MasterKind, Array<{ doctype: string; fields: string[]; company: boolean; map: (r: Record<string, unknown>) => NormalisedMaster }>>> = {
  party: [
    { doctype: 'Supplier', fields: ['name', 'supplier_name', 'tax_id', 'disabled', 'is_internal_supplier'], company: false,
      map: (r) => ({ kind: 'party', externalId: `Supplier:${r.name}`, role: 'vendor', taxId: (r.tax_id as string) ?? null, name: String(r.supplier_name ?? r.name), active: r.disabled !== 1, internal: r.is_internal_supplier === 1 }) },
    { doctype: 'Customer', fields: ['name', 'customer_name', 'tax_id', 'disabled', 'is_internal_customer'], company: false,
      map: (r) => ({ kind: 'party', externalId: `Customer:${r.name}`, role: 'client', taxId: (r.tax_id as string) ?? null, name: String(r.customer_name ?? r.name), active: r.disabled !== 1, internal: r.is_internal_customer === 1 }) },
  ],
  project: [{ doctype: 'Project', fields: ['name', 'project_name', 'status'], company: true,
    map: (r) => ({ kind: 'project', externalId: String(r.name), code: String(r.name), name: String(r.project_name ?? r.name), active: r.status !== 'Cancelled' }) }],
  item: [{ doctype: 'Item', fields: ['name', 'item_name', 'disabled'], company: false,
    map: (r) => ({ kind: 'item', externalId: String(r.name), code: String(r.name), name: String(r.item_name ?? r.name), active: r.disabled !== 1 }) }],
  employee: [{ doctype: 'Employee', fields: ['name', 'employee_name', 'company_email', 'user_id', 'status'], company: true,
    map: (r) => ({ kind: 'employee', externalId: String(r.name), code: String(r.company_email ?? r.user_id ?? '').toLowerCase() || null,
      name: String(r.employee_name ?? r.name), active: r.status === 'Active' }) }],
  account: [{ doctype: 'Account', fields: ['name', 'account_name', 'account_number', 'parent_account', 'root_type', 'is_group', 'disabled'], company: true,
    map: (r) => ({ kind: 'account', externalId: String(r.name), code: accountCategoryKey({ account: String(r.name), accountName: String(r.account_name ?? ''), accountNumber: (r.account_number as string) ?? null, parentAccount: (r.parent_account as string) ?? null, rootType: String(r.root_type ?? ''), isGroup: r.is_group === 1, disabled: r.disabled === 1 }), name: String(r.account_name ?? r.name), active: r.disabled !== 1 && r.is_group !== 1 }) }],
};
/** FR-ECA-001 money domains: submitted documents only. */
const DOMAIN_COUNTS: Record<CensusDomain, Array<{ doctype: string; extra?: unknown[][] }>> = {
  budget: [{ doctype: 'Budget' }], invoice: [{ doctype: 'Sales Invoice' }], timesheet: [{ doctype: 'Timesheet' }],
  purchase: [{ doctype: 'Purchase Order' }, { doctype: 'Purchase Receipt' }, { doctype: 'Purchase Invoice' }],
  receipt: [{ doctype: 'Payment Entry', extra: [['payment_type', '=', 'Receive']] }],
  payment: [{ doctype: 'Payment Entry', extra: [['payment_type', '=', 'Pay']] }],
};
export function createErpnextConnectAdapter(client: ErpClientDeps, company: string): ConnectAdapter {
  const specOf = (kind: string) => { const s = SPECS[kind as MasterKind]; if (!s) throw new AdapterError('commit-rejected', `kind ${kind} unavailable`); return s; };
  const filters = (company_: boolean, after: string | null) => [...(company_ ? [['company', '=', company]] : []), ...(after ? [['name', '>', after]] : [])];
  return {
    tier: 'erpnext',
    async listMasters(kind, cursor) {
      const specs = specOf(kind);
      const [doctype, after] = cursor ? [cursor.slice(0, cursor.indexOf(':')), cursor.slice(cursor.indexOf(':') + 1)] : [specs[0].doctype, null];
      const i = specs.findIndex((s) => s.doctype === doctype); const s = specs[i];
      if (!s) throw new AdapterError('commit-rejected', `cursor does not belong to ${kind}`);
      const q = new URLSearchParams({ fields: JSON.stringify(s.fields), filters: JSON.stringify(filters(s.company, after)), order_by: 'name asc', limit_page_length: String(ERP_CONNECT_PAGE) });
      const res = await erpnextRequest(client, { method: 'GET', path: `/api/resource/${encodeURIComponent(s.doctype)}?${q}` }) as { data?: Array<Record<string, unknown>> };
      const rows = res.data ?? [];
      const next = rows.length === ERP_CONNECT_PAGE ? `${s.doctype}:${rows.at(-1)!.name}` : specs[i + 1] ? `${specs[i + 1].doctype}:` : null;
      return { rows: rows.map(s.map), nextCursor: next };
    },
    async countDomain(kind) {
      let total = 0;
      const money = DOMAIN_COUNTS[kind as CensusDomain];
      for (const d of money ?? []) {
        const q = new URLSearchParams({ doctype: d.doctype, filters: JSON.stringify([['company', '=', company], ['docstatus', '=', 1], ...(d.extra ?? [])]) });
        total += Number((await erpnextRequest(client, { method: 'GET', path: `/api/method/frappe.client.get_count?${q}` }) as { message?: number }).message ?? 0);
      }
      if (money) return total;
      for (const s of specOf(kind)) {
        const q = new URLSearchParams({ doctype: s.doctype, filters: JSON.stringify(filters(s.company, null)) });
        total += Number((await erpnextRequest(client, { method: 'GET', path: `/api/method/frappe.client.get_count?${q}` }) as { message?: number }).message ?? 0);
      }
      return total;
    },
    async sendMaster() { throw new AdapterError('commit-rejected', 'send unavailable until ECA-3'); },
  };
}
