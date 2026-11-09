/**
 * `ConnectAdapter` for Odoo (ECA §6.2): list and count master kinds, and send PMO masters by lookup-then-create so a
 * retry after a lost response finds the first attempt's record (NFR-ECA-001). The send key is the outbox caller's (S8).
 */
import { AdapterError } from '../contract.ts';
import type { ConnectAdapter, MasterKind, NormalisedMaster, PmoMaster } from '../connect/types.ts';
import { OdooError, type OdooCall } from './client.ts';
import {
  ACCOUNT_FIELDS, ITEM_FIELDS, normaliseAccount, normaliseItem, normaliseParty, normaliseProject, partyExternalId, PARTY_FIELDS,
  PROJECT_FIELDS,
} from './normalise.ts';

export const ODOO_TIER = 'odoo';
export const LIST_PAGE = 200;

/**
 * The partners Odoo holds for itself, not for the client's trade (#2048, #2049), decided by partner id, never the name
 * (FR-ODC-052, #1690): a real vendor may share the company's name.
 * - `company`: the partners of the database's companies (PMO's own organisation); never a customer or vendor, whatever
 *   their rank.
 * - `user`: the partners of its login users (`res.users.partner_id`, `active_test` off), which reaches every user Odoo
 *   itself creates without relying on its XML ids: Administrator, OdooBot, the public user, the portal template user,
 *   archived and portal users, and PMO's own adapter login. A user partner is Odoo's own only while it has no trade
 *   role: a vendor or client given a portal login is still a vendor or client. (An employee's partner that carries a
 *   supplier rank is a real payee, so it is a vendor.)
 * Both the setup pass and the partner feed read it.
 * ponytail: one unpaged read of `res.users`; page it by id if a database holds tens of thousands of portal users.
 */
export interface OdooOwnPartners { company: ReadonlySet<number>; user: ReadonlySet<number> }
export const odooOwnPartnerIds = async (call: OdooCall): Promise<OdooOwnPartners> => {
  const ids = (rows: Array<{ partner_id: [number, string] | false }>) => new Set(rows.flatMap((r) => (r.partner_id ? [r.partner_id[0]] : [])));
  const [companies, users] = await Promise.all([
    call<Array<{ partner_id: [number, string] | false }>>('res.company', 'search_read', { domain: [], fields: ['partner_id'] }),
    call<Array<{ partner_id: [number, string] | false }>>('res.users', 'search_read', { domain: [], fields: ['partner_id'], context: { active_test: false } }),
  ]);
  return { company: ids(companies), user: ids(users) };
};

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

/**
 * The Odoo record a send of this PMO master would find (lookup half of `sendMaster`), or null. Two records answering
 * one anchor is `ambiguous`. party: `ref = pmo:<id>`; project: `code` in the plan and company; item: `default_code`.
 */
async function findSent(call: OdooCall, ctx: OdooConnectCtx, kind: MasterKind, record: PmoMaster): Promise<string | null> {
  const one = async (model: string, domain: unknown[]) => {
    const hits = await call<{ id: number }[]>(model, 'search_read', { domain, fields: ['id'], limit: 2, context: { active_test: false } });
    if (hits.length > 1) throw new AdapterError('commit-rejected', 'ambiguous');
    return hits[0]?.id ?? null;
  };
  if (kind === 'party') {
    const id = await one('res.partner', [['ref', '=', `pmo:${record.id}`]]);
    return id === null ? null : partyExternalId(record.role === 'client' ? 'client' : 'vendor', id);
  }
  if (kind === 'project') {
    const id = await one('account.analytic.account', [['code', '=', record.code], ...SPECS.project!.domain(ctx)]);
    return id === null ? null : String(id);
  }
  if (kind === 'item') {
    const id = await one('product.product', [['default_code', '=', record.code], ...SPECS.item!.domain(ctx)]);
    return id === null ? null : String(id);
  }
  return null;
}

/** The money outbox's recovery probe for an Odoo send (ADR-0058 §3): same lookup as `sendMaster`, so a lost answer is adopted, never re-created. */
export async function odooSendProbe(call: OdooCall, ctx: OdooConnectCtx, kind: MasterKind, record: PmoMaster): Promise<{ externalRecordId: string } | null> {
  if (kind === 'project') planOf(ctx);
  try {
    const id = await findSent(call, ctx, kind, record);
    return id === null ? null : { externalRecordId: id };
  } catch (err) { toAdapterError(err); }
}

export function createOdooConnectAdapter(call: OdooCall, ctx: OdooConnectCtx): ConnectAdapter {
  const create = async (model: string, vals: Raw) => (await call<number[]>(model, 'create', { vals_list: [vals] }))[0];
  // read once per adapter (one tick), not once per page; a failed read is not remembered
  let own: Promise<OdooOwnPartners> | undefined;
  const ownPartnerIds = () => (own ??= odooOwnPartnerIds(call).catch((e) => { own = undefined; throw e; }));
  const norm = async (kind: MasterKind, rows: Raw[]): Promise<NormalisedMaster[]> => {
    if (kind === 'party') { const ids = await ownPartnerIds(); return rows.flatMap((r) => normaliseParty(r, ids)); }
    return rows.map(kind === 'project' ? normaliseProject : kind === 'item' ? normaliseItem : normaliseAccount);
  };

  return {
    tier: ODOO_TIER,
    // a cost account's code carries the PMO project number (FR-ODC-072), so the matcher compares it with that (#1692)
    projectCodeField: 'pmo_project_number',

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
      try {
        // the census leaves out Odoo's own partners (#2048): the companies' partners, and the login partners with no trade
        // role. listMasters keeps them flagged `internal`, so the matcher and the review skip them.
        let d = s.domain(ctx);
        if (domain === 'party') {
          const { company, user } = await ownPartnerIds();
          d = [...d, ['id', 'not in', [...company]], '!', '&', ['id', 'in', [...user]], '&', ['supplier_rank', '=', 0], ['customer_rank', '=', 0]];
        }
        return await call<number>(s.model, 'search_count', { domain: d, context: { active_test: false } });
      } catch (err) { toAdapterError(err); }
    },

    async sendMaster(kind, record, _key) {
      if (kind === 'item' && record.unit && !ctx.unitMap[record.unit]) throw new AdapterError('commit-rejected', 'unit-unmapped');
      if (kind === 'project') planOf(ctx);
      try {
        const found = await findSent(call, ctx, kind, record);
        if (found !== null) return { externalId: found };
        if (kind === 'party') {
          const role = record.role === 'client' ? 'client' : 'vendor';
          const id = await create('res.partner', {
            name: record.name, vat: record.taxId || false, ref: `pmo:${record.id}`, is_company: true, [role === 'vendor' ? 'supplier_rank' : 'customer_rank']: 1,
          });
          return { externalId: partyExternalId(role, id) };
        }
        if (kind === 'project') {
          const id = await create('account.analytic.account', {
            name: `${record.code} ${record.name}`, code: record.code, plan_id: ctx.analyticPlanId, company_id: ctx.companyId,
          });
          return { externalId: String(id) };
        }
        if (kind === 'item') {
          const uom = record.unit ? Number(ctx.unitMap[record.unit]) : undefined;
          const id = await create('product.product', {
            default_code: record.code, name: record.name, purchase_ok: true, ...(uom ? { uom_id: uom } : {}),
          });
          return { externalId: String(id) };
        }
      } catch (err) { toAdapterError(err); }
      throw new AdapterError('commit-rejected', `send ${kind} unavailable`);
    },
  };
}

/**
 * What the shared setup (census, run, proposals) sees of Odoo: a kind Odoo cannot serve yet is empty, not an error, so
 * one unserved kind never fails the census. People wait for O7 (#1510); cost accounts wait for the Admin to choose the
 * analytic plan. Neither can be sent until then, so setup proposes no send for them.
 */
export function createOdooSetupAdapter(call: OdooCall, ctx: OdooConnectCtx): ConnectAdapter {
  const inner = createOdooConnectAdapter(call, ctx);
  const unserved = (kind: string) => kind === 'employee' || (kind === 'project' && ctx.analyticPlanId === null);
  return {
    ...inner,
    listMasters: async (kind, cursor) => (unserved(kind) ? { rows: [], nextCursor: null } : await inner.listMasters(kind, cursor)),
    countDomain: async (domain) => (unserved(domain) ? 0 : await inner.countDomain(domain)),
    canSend: (kind) => !unserved(kind),
  };
}
