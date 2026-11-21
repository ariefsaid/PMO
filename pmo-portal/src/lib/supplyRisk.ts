/**
 * #2583 — a supplier's supply-risk SUGGESTION from payables age (spec vendor-supply-risk.spec.md).
 *
 * The status is a human decision (OD-VSR-1); this only suggests. The authoritative computation is the database
 * function `vendor_supply_risk_suggestion` (migration 1066) — the screen reads that. This pure mirror applies the SAME
 * rule (the shipped payables figure at case level: `supplierUnpaid` with the case's linked accounting-system documents,
 * aged from the case's earliest invoice date, over-60 = the 61-90 and over-90 payables buckets) so a unit case and a
 * pgTAP case share one hand example and the two cannot drift. Money is summed in whole cents; currencies never blend.
 */
import { calendarAgeDays, isProcurementReadyToPay, supplierInvoiceDate } from '@/src/lib/finance/financePosition';
import { supplierUnpaid, type ProcurementMoneyInput } from '@/src/lib/procurement/procurementMoney';
import { toCents } from '@/src/lib/moneyCents';

export type SupplyRiskStatus = 'active' | 'at_risk' | 'inactive';

/** One procurement case of the supplier with the documents the shipped payables figure reads. */
export interface SupplyRiskCase {
  status: string;
  currency: string;
  invoices: readonly { amount: number | string | null; invoice_date: string | null }[];
  payments: readonly { amount: number | string | null; status: string }[];
  erpDocuments?: ProcurementMoneyInput['erpDocuments'];
}

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

const OVER_60 = 60;

export function suggestSupplyRisk(cases: readonly SupplyRiskCase[], today: string): SupplyRiskSuggestion {
  const byCurrency = new Map<string, { unpaid: number; over60: number; count: number; oldest: number | null }>();
  let unknownCount = 0;
  let oldestOverall: number | null = null;

  for (const row of cases) {
    if (!isProcurementReadyToPay({ status: row.status as Parameters<typeof isProcurementReadyToPay>[0]['status'] })) continue;
    const money = supplierUnpaid({
      procurement_invoices: row.invoices,
      payments: row.payments,
      erpDocuments: row.erpDocuments,
    });
    if (money.unknown || money.amount === null) {
      unknownCount += 1;
      continue;
    }
    const cents = toCents(money.amount);
    if (cents <= 0) continue;
    const age = calendarAgeDays(supplierInvoiceDate({ procurement_invoices: row.invoices.map((i) => ({ invoice_date: i.invoice_date })) as never }), today);
    const entry = byCurrency.get(row.currency) ?? { unpaid: 0, over60: 0, count: 0, oldest: null };
    entry.unpaid += cents;
    if (age !== null) {
      entry.oldest = entry.oldest === null ? age : Math.max(entry.oldest, age);
      oldestOverall = oldestOverall === null ? age : Math.max(oldestOverall, age);
      if (age > OVER_60) {
        entry.over60 += cents;
        entry.count += row.invoices.length;
      }
    }
    byCurrency.set(row.currency, entry);
  }

  const currencies = [...byCurrency.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, v]) => ({
      currency,
      unpaidAmount: v.unpaid / 100,
      over60Amount: v.over60 / 100,
      invoiceCount: v.count,
      oldestAgeDays: v.oldest,
    }));
  const atRisk = currencies.some((c) => c.over60Amount > 0);
  return {
    basis: 'pmo',
    suggestedStatus: atRisk ? 'at_risk' : 'active',
    noAgingData: false,
    unknownCount,
    oldestAgeDays: oldestOverall,
    currencies,
  };
}
