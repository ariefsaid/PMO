/**
 * The Odoo `Adapter` (contract.ts) for `companies`, used by adapter-dispatch once the org employs companies under tier
 * `odoo` (PQ-6). Creates share `sendMaster('party')`'s lookup-then-create. PMO `companies` shape only
 * (NFR-EAS-CONTRACT-001): the role comes from the external id prefix.
 */
import { AdapterError, type Adapter, type PmoRecord } from '../contract.ts';
import type { OdooCall } from './client.ts';
import { createOdooConnectAdapter, LIST_PAGE, ODOO_TIER, toAdapterError, type OdooConnectCtx } from './connectAdapter.ts';
import { normaliseParty } from './normalise.ts';

type Raw = Record<string, unknown>;
interface CompanyRecord { id: string; name: string; type: 'Vendor' | 'Client'; erp_tax_id?: string | null; externalRecordId?: string }

function companiesOnly(domain: string): void {
  if (domain !== 'companies') throw new AdapterError('commit-rejected', 'unsupported domain');
}

function partnerId(externalId: string): number {
  const id = Number(/^(?:Vendor|Client):(\d+)$/.exec(externalId)?.[1]);
  if (!id) throw new AdapterError('commit-rejected', 'invalid external id');
  return id;
}

const toPmoCompany = (externalId: string, r: Raw): PmoRecord => {
  const type = externalId.startsWith('Client:') ? 'Client' : 'Vendor';
  return { id: externalId, name: String(r.name), type, erp_party_type: type, erp_tax_id: typeof r.vat === 'string' ? r.vat : null, erp_modified: String(r.write_date) };
};

const canonical = (r: CompanyRecord) => ({ id: r.id, name: r.name, type: r.type, erp_party_type: r.type, erp_tax_id: r.erp_tax_id ?? null });

export function createOdooAdapter(call: OdooCall, ctx: OdooConnectCtx): Adapter {
  const connect = createOdooConnectAdapter(call, ctx);
  return {
    tier: ODOO_TIER,
    capabilityMap: new Set(['companies']),

    async commit(cmd) {
      companiesOnly(cmd.domain);
      const r = cmd.record as unknown as CompanyRecord;
      if (cmd.operation === 'create') {
        const role = r.type === 'Client' ? 'client' : 'vendor';
        const { externalId } = await connect.sendMaster('party', { id: r.id, name: r.name, taxId: r.erp_tax_id ?? null, role }, `odoo:companies:${r.id}`);
        return { externalRecordId: externalId, canonical: canonical(r) };
      }
      if (cmd.operation === 'update' && r.externalRecordId) {
        const ids = [partnerId(r.externalRecordId)];
        try { await call('res.partner', 'write', { ids, vals: { name: r.name, vat: r.erp_tax_id || false } }); } catch (err) { toAdapterError(err); }
        return { externalRecordId: r.externalRecordId, canonical: canonical(r) };
      }
      throw new AdapterError('commit-rejected', `unsupported operation ${cmd.operation}`);
    },

    async getByExternalId(domain, externalRecordId) {
      companiesOnly(domain);
      const id = partnerId(externalRecordId);
      try {
        const [row] = await call<Raw[]>('res.partner', 'search_read', { domain: [['id', '=', id]], fields: ['name', 'vat', 'write_date'], limit: 1, context: { active_test: false } });
        return row ? toPmoCompany(externalRecordId, row) : null;
      } catch (err) { toAdapterError(err); }
    },

    async listChangesSinceWatermark(domain, cursor) {
      companiesOnly(domain);
      const k = cursor ? (JSON.parse(cursor) as { w: string; id: number }) : null;
      // ponytail: S4 moves this keyset into odoo/sweep.ts (keysetDomain) and imports it here.
      const after = k ? ['|', ['write_date', '>', k.w], '&', ['write_date', '=', k.w], ['id', '>', k.id]] : [];
      try {
        const rows = await call<Raw[]>('res.partner', 'search_read', {
          domain: [['parent_id', '=', false], ...after],
          fields: ['name', 'vat', 'supplier_rank', 'customer_rank', 'is_company', 'parent_id', 'ref', 'active', 'write_date'],
          order: 'write_date asc, id asc', limit: LIST_PAGE, context: { active_test: false },
        });
        const last = rows.at(-1) as { id: number; write_date: string } | undefined;
        return {
          changes: rows.flatMap((r) => normaliseParty(r).filter((n) => n.role).map((n) => toPmoCompany(n.externalId, r))),
          nextCursor: last && rows.length === LIST_PAGE ? JSON.stringify({ w: last.write_date, id: last.id }) : null,
        };
      } catch (err) { toAdapterError(err); }
    },
  };
}
