/**
 * `ConnectAdapter` for Odoo (ECA §6.2): list and count master kinds, and send PMO masters by lookup-then-create so a
 * retry after a lost response finds the first attempt's record (NFR-ECA-001). The send key is the outbox caller's (S8).
 */
import { AdapterError } from '../contract.ts';
import type { ConnectAdapter, MasterKind, NormalisedMaster } from '../connect/types.ts';
import { OdooError, type OdooCall } from './client.ts';
import {
  ACCOUNT_FIELDS, ITEM_FIELDS, normaliseAccount, normaliseItem, normaliseParty, normaliseProject, partyExternalId, PARTY_FIELDS,
  PROJECT_FIELDS,
} from './normalise.ts';

export const ODOO_TIER = 'odoo';
export const LIST_PAGE = 200;

export interface OdooConnectCtx {
  companyId: number;
  /** The analytic plan whose accounts are PMO projects; null until the Admin chooses one. */
  analyticPlanId: number | null;
  /** PMO unit → Odoo `uom.uom` id. */
  unitMap: Record<string, string>;
}

type Raw = Record<string, unknown>;

const TRANSIENT = new Set(['unreachable', 'timeout', 'tls', 'server-error', 'destination-refused']);

/** Odoo failures in contract terms; the message is the error class, never Odoo's text. */
export function toAdapterError(err: unknown): never {
  if (err instanceof OdooError) throw new AdapterError(TRANSIENT.has(err.errorClass) ? 'external-unreachable' : 'commit-rejected', err.errorClass);
  throw err;
}

const planOf = (c: OdooConnectCtx) => {
  if (c.analyticPlanId === null) throw new AdapterError('commit-rejected', 'analytic-plan-unset');
  return c.analyticPlanId;
};

interface KindSpec { model: string; fields: string[]; domain: (c: OdooConnectCtx) => unknown[] }
const SPECS: Partial<Record<MasterKind, KindSpec>> = {
  party: { model: 'res.partner', fields: PARTY_FIELDS, domain: () => [['parent_id', '=', false]] },
  project: { model: 'account.analytic.account', fields: PROJECT_FIELDS, domain: (c) => [['plan_id', '=', planOf(c)], ['company_id', 'in', [c.companyId, false]]] },
  item: { model: 'product.product', fields: ITEM_FIELDS, domain: (c) => [['company_id', 'in', [c.companyId, false]]] },
  account: { model: 'account.account', fields: ACCOUNT_FIELDS, domain: () => [] },
};

function spec(kind: string): KindSpec {
  const s = SPECS[kind as MasterKind];
  if (!s) throw new AdapterError('commit-rejected', `kind ${kind} unavailable`);
  return s;
}

export function createOdooConnectAdapter(call: OdooCall, ctx: OdooConnectCtx): ConnectAdapter {
  const one = async (model: string, domain: unknown[]) => {
    const hits = await call<{ id: number }[]>(model, 'search_read', { domain, fields: ['id'], limit: 2, context: { active_test: false } });
    if (hits.length > 1) throw new AdapterError('commit-rejected', 'ambiguous');
    return hits[0]?.id ?? null;
  };
  const create = async (model: string, vals: Raw) => (await call<number[]>(model, 'create', { vals_list: [vals] }))[0];
  const ownPartnerIds = async () => {
    const companies = await call<Array<{ partner_id: [number, string] | false }>>('res.company', 'search_read', { domain: [], fields: ['partner_id'] });
    return new Set(companies.flatMap((c) => (c.partner_id ? [c.partner_id[0]] : [])));
  };
  const norm = async (kind: MasterKind, rows: Raw[]): Promise<NormalisedMaster[]> => {
    if (kind === 'party') { const own = await ownPartnerIds(); return rows.flatMap((r) => normaliseParty(r, own)); }
    return rows.map(kind === 'project' ? normaliseProject : kind === 'item' ? normaliseItem : normaliseAccount);
  };

  return {
    tier: ODOO_TIER,

    async listMasters(kind, cursor) {
      const s = spec(kind);
      const domain = [...s.domain(ctx), ['id', '>', Number(cursor ?? 0)]];
      try {
        const rows = await call<Raw[]>(s.model, 'search_read', { domain, fields: ['id', ...s.fields], order: 'id asc', limit: LIST_PAGE, context: { active_test: false } });
        return { rows: await norm(kind, rows), nextCursor: rows.length < LIST_PAGE ? null : String(rows.at(-1)!.id) };
      } catch (err) { toAdapterError(err); }
    },

    async countDomain(domain) {
      const s = spec(domain);
      const d = s.domain(ctx);
      try { return await call<number>(s.model, 'search_count', { domain: d, context: { active_test: false } }); } catch (err) { toAdapterError(err); }
    },

    async sendMaster(kind, record, _key) {
      if (kind === 'item' && record.unit && !ctx.unitMap[record.unit]) throw new AdapterError('commit-rejected', 'unit-unmapped');
      if (kind === 'project') planOf(ctx);
      try {
        if (kind === 'party') {
          const role = record.role === 'client' ? 'client' : 'vendor';
          const anchor = `pmo:${record.id}`;
          const id = (await one('res.partner', [['ref', '=', anchor]])) ?? await create('res.partner', {
            name: record.name, vat: record.taxId || false, ref: anchor, is_company: true, [role === 'vendor' ? 'supplier_rank' : 'customer_rank']: 1,
          });
          return { externalId: partyExternalId(role, id) };
        }
        if (kind === 'project') {
          const id = (await one('account.analytic.account', [['code', '=', record.code], ...SPECS.project!.domain(ctx)])) ?? await create('account.analytic.account', {
            name: `${record.code} ${record.name}`, code: record.code, plan_id: ctx.analyticPlanId, company_id: ctx.companyId,
          });
          return { externalId: String(id) };
        }
        if (kind === 'item') {
          const uom = record.unit ? Number(ctx.unitMap[record.unit]) : undefined;
          const id = (await one('product.product', [['default_code', '=', record.code], ...SPECS.item!.domain(ctx)])) ?? await create('product.product', {
            default_code: record.code, name: record.name, purchase_ok: true, ...(uom ? { uom_id: uom } : {}),
          });
          return { externalId: String(id) };
        }
      } catch (err) { toAdapterError(err); }
      throw new AdapterError('commit-rejected', `send ${kind} unavailable`);
    },
  };
}
