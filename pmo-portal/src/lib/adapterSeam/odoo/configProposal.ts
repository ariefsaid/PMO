/**
 * The "map once" proposal (AC-ODC-096, FR-ODC-061/090): from the mirrored Odoo records, one value per setting where exactly one
 * record fits, otherwise the candidates to choose from. Pure and deterministic; it never guesses between two.
 */
export interface ConfigMaster { external_id: string; name: string; active: boolean; tombstoned_at: string | null; attrs: Record<string, unknown> }
export type ConfigProposal = { key: string; value: string; reason: 'unique' } | { key: string; candidates: string[]; reason: 'choose' };

/** Which Odoo account types may serve each default. */
export const DEFAULT_TYPES: Record<string, readonly string[]> = {
  payable: ['liability_payable'], receivable: ['asset_receivable'], bank: ['asset_cash'], cash: ['asset_cash'],
  expense: ['expense', 'expense_direct_cost'], stock_valuation: ['asset_current'], stock_consumption: ['expense_direct_cost'],
};
/** Account types a default may never point to (kept in step with `set_odoo_org_config`): the old group type, and off-balance accounts. */
export const UNUSABLE_ACCOUNT_TYPES: readonly string[] = ['view', 'off_balance'];
export const isLive = (r: { active: boolean; tombstoned_at: string | null }) => r.active && !r.tombstoned_at;
/** NFC, not NFKC: "m2" and "m²" are different unit texts and must be chosen by a person, not equated. */
const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, '');

export function proposeOdooConfig(input: { accounts: ConfigMaster[]; uoms: ConfigMaster[]; warehouses: ConfigMaster[]; pmoUnits: string[] }): ConfigProposal[] {
  const pick = (key: string, rows: ConfigMaster[]): ConfigProposal =>
    rows.length === 1 ? { key, value: rows[0].external_id, reason: 'unique' } : { key, candidates: rows.map((r) => r.external_id), reason: 'choose' };
  const out = Object.entries(DEFAULT_TYPES).map(([key, types]) =>
    pick(`account_defaults.${key}`, input.accounts.filter((a) => isLive(a) && types.includes(String(a.attrs.account_type)))));
  for (const unit of input.pmoUnits) out.push(pick(`unit_map.${unit}`, input.uoms.filter((u) => isLive(u) && norm(u.name) === norm(unit))));
  out.push(pick('default_warehouse_id', input.warehouses.filter(isLive)));
  return out;
}
