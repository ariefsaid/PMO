/**
 * #2583 — a supplier's supply-risk status vocabulary and the suggestion the database returns (vendor-supply-risk.spec.md).
 *
 * The status is a human decision (OD-VSR-1); the database only suggests. The authoritative computation is the database
 * function `vendor_supply_risk_suggestion` (migration 1066) — the screen reads it, so the aging rule is not restated
 * client-side (#2753). These types are the shape of that answer, shared by the DAL, the repository and the card.
 */

export type SupplyRiskStatus = 'active' | 'at_risk' | 'inactive';

export interface SupplyRiskCurrency {
  currency: string;
  /** Total unpaid across the supplier's counted cases. */
  unpaidAmount: number;
  /** Unpaid in the over-60-day range (61-90 plus over 90). */
  over60Amount: number;
  /** PMO invoices behind the over-60 figure; null on the ERP basis (the aging snapshot has buckets, not counts). */
  invoiceCount: number | null;
  oldestAgeDays: number | null;
}

export interface SupplyRiskSuggestion {
  basis: 'pmo' | 'erp';
  /** null = no aging data (ERP basis, nothing matched): never `active` by default. */
  suggestedStatus: Exclude<SupplyRiskStatus, 'inactive'> | null;
  noAgingData: boolean;
  /** Cases whose balance is unknown (an amount missing): counted, never zero, never raising the suggestion. */
  unknownCount: number;
  oldestAgeDays: number | null;
  currencies: SupplyRiskCurrency[];
}
