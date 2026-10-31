/**
 * Odoo records → `NormalisedMaster` (AC-ODC-032, SD-8). Matching itself is shared (`connect/match.ts`); this file only
 * says what an Odoo record is in PMO terms.
 */
import type { NormalisedMaster } from '../connect/types.ts';

type Raw = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

export const PARTY_FIELDS = ['name', 'vat', 'ref', 'is_company', 'parent_id', 'active', 'supplier_rank', 'customer_rank', 'write_date'];
export const PROJECT_FIELDS = ['name', 'code', 'plan_id', 'company_id', 'active', 'write_date'];
export const ITEM_FIELDS = ['default_code', 'name', 'uom_id', 'purchase_ok', 'sale_ok', 'active', 'write_date'];
export const ACCOUNT_FIELDS = ['code', 'name', 'account_type', 'active', 'write_date'];

/** `Vendor:<id>` / `Client:<id>`: the role lives in the external id, so one partner holding both roles is two PMO companies. */
export const partyExternalId = (role: 'vendor' | 'client', id: number | string) => `${role === 'vendor' ? 'Vendor' : 'Client'}:${id}`;

/**
 * One row per role the partner holds (supplier/customer rank > 0); a child contact yields none (FR-ODC-053); a partner
 * with no rank yields one role-less row the matcher sends to review (FR-ODC-052). `ownPartnerIds` are the partners of
 * the database's companies, PMO's own organisation.
 */
export function normaliseParty(r: Raw, ownPartnerIds: ReadonlySet<number> = new Set()): NormalisedMaster[] {
  if (r.is_company !== true && r.parent_id !== false) return [];
  const base = {
    kind: 'party' as const, taxId: str(r.vat), code: str(r.ref), name: String(r.name),
    active: r.active !== false, internal: ownPartnerIds.has(Number(r.id)),
  };
  const roles: Array<'vendor' | 'client'> = [];
  if (Number(r.supplier_rank) > 0) roles.push('vendor');
  if (Number(r.customer_rank) > 0) roles.push('client');
  if (roles.length === 0) return [{ ...base, externalId: String(r.id) }];
  return roles.map((role) => ({ ...base, role, externalId: partyExternalId(role, Number(r.id)) }));
}

const simple = (kind: 'project' | 'item' | 'account', codeField: string) => (r: Raw): NormalisedMaster =>
  ({ kind, externalId: String(r.id), code: str(r[codeField]), name: String(r.name), active: r.active !== false });

/** A cost account (`account.analytic.account` of the chosen plan); its code is the PMO project number. */
export const normaliseProject = simple('project', 'code');
export const normaliseItem = simple('item', 'default_code');
export const normaliseAccount = simple('account', 'code');
