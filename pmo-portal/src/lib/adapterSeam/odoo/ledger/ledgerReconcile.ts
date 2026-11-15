/**
 * AC-ODA-008 / FR-ODA-040..042: compare PMO's per-account sums of mirrored posted lines with Odoo's grouped totals.
 * Pure. A difference is reported with both figures and never corrected; no successful grouped read means "not checked".
 */
import { formatCents, nanoToCents, toNano } from './cents.ts';

export interface PmoLine { account: string; debit: string; credit: string; writeDate: string; isCancelled: boolean }
export type Totals = Readonly<Record<string, { debit: string; credit: string }>>;
export type OdooTotals = { ok: true; totals: Totals } | { ok: false; reason: string };
interface Figures { debit: string; credit: string }

export type ReconcileResult =
  | { state: 'matches'; accounts: number }
  | { state: 'differs'; accounts: number; differing: Array<{ account: string; pmo: Figures; odoo: Figures }> }
  | { state: 'not-checked'; reason: string };

const cents = (v: string): bigint => {
  const n = toNano(v);
  if (n === null) throw new Error(`reconcile: malformed amount ${v}`);
  return nanoToCents(n);
};

export function compareTotals({ lines, odoo, cutoff }: { lines: readonly PmoLine[]; odoo: OdooTotals; cutoff: string }): ReconcileResult {
  if (!odoo.ok) return { state: 'not-checked', reason: odoo.reason };
  const pmo = new Map<string, { debit: bigint; credit: bigint }>();
  // Cancelled lines never count; lines changed after the cut-off belong to the next check (write_date is a fixed-width UTC string).
  for (const l of lines) {
    if (l.isCancelled || l.writeDate > cutoff) continue;
    const t = pmo.get(l.account) ?? { debit: 0n, credit: 0n };
    t.debit += cents(l.debit);
    t.credit += cents(l.credit);
    pmo.set(l.account, t);
  }
  const theirs = new Map(Object.entries(odoo.totals).map(([a, t]) => [a, { debit: cents(t.debit), credit: cents(t.credit) }]));
  const accounts = [...new Set([...pmo.keys(), ...theirs.keys()])].sort();
  const zero = { debit: 0n, credit: 0n };
  const fmt = (t: { debit: bigint; credit: bigint }) => ({ debit: formatCents(t.debit), credit: formatCents(t.credit) });
  const differing = accounts.flatMap((account) => {
    const p = pmo.get(account) ?? zero, o = theirs.get(account) ?? zero;
    return p.debit === o.debit && p.credit === o.credit ? [] : [{ account, pmo: fmt(p), odoo: fmt(o) }];
  });
  return differing.length === 0 ? { state: 'matches', accounts: accounts.length } : { state: 'differs', accounts: accounts.length, differing };
}

/** #2282 D8(b): one stored issued-material line, as the stock-cost comparison sees it. */
export interface StockCostLine { analyticAccount: string | null; debit: string; credit: string; writeDate: string; isCancelled: boolean }
/** Odoo's per-analytic-account sum of `amount` over the D2 domain (negative = cost), as an exact decimal string. */
export type OdooStockCostTotals = { ok: true; totals: Readonly<Record<string, string>> } | { ok: false; reason: string };
export type StockCostResult =
  | { state: 'matches'; accounts: number }
  | { state: 'differs'; accounts: number; differing: Array<{ account: string; pmo: Figures; odoo: Figures }> }
  | { state: 'not-checked'; reason: string };

/** Compares PMO's stored cost per analytic account (debit − credit) with Odoo's (−amount), same cut-off rule as the GL check. */
export function compareStockCost({ lines, odoo, cutoff }: { lines: readonly StockCostLine[]; odoo: OdooStockCostTotals; cutoff: string }): StockCostResult {
  if (!odoo.ok) return { state: 'not-checked', reason: odoo.reason };
  const pmo = new Map<string, bigint>();
  for (const l of lines) {
    if (l.isCancelled || l.writeDate > cutoff) continue;
    const key = l.analyticAccount ?? 'none';
    pmo.set(key, (pmo.get(key) ?? 0n) + cents(l.debit) - cents(l.credit));
  }
  const theirs = new Map(Object.entries(odoo.totals).map(([a, amount]) => [a, -cents(amount)]));
  const accounts = [...new Set([...pmo.keys(), ...theirs.keys()])].sort();
  const fig = (net: bigint): Figures => ({ debit: formatCents(net > 0n ? net : 0n), credit: formatCents(net < 0n ? -net : 0n) });
  const differing = accounts.flatMap((account) => {
    const p = pmo.get(account) ?? 0n, o = theirs.get(account) ?? 0n;
    return p === o ? [] : [{ account, pmo: fig(p), odoo: fig(o) }];
  });
  return differing.length === 0 ? { state: 'matches', accounts: accounts.length } : { state: 'differs', accounts: accounts.length, differing };
}

/** A tied stored line with the stock moves of its picking. */
export interface TiedStockCost { analyticLineId: string; analyticAccount: string | null; stockMoveIds: readonly number[] }
/** A journal item that values a stock move, with the analytic accounts its distribution names. */
export interface StockJournalLine { stockMoveId: number; analyticAccounts: readonly string[] }

/**
 * #2282 D8(c): a customised Odoo could tag the COGS journal item of an issue to the project; the GL kind then already counts the cost,
 * so the analytic line must not count again. Returns the analytic line ids whose picking has such a journal item on the same account.
 */
export function findDoubleCounts(journal: readonly StockJournalLine[], tied: readonly TiedStockCost[]): string[] {
  const tagged = new Map<number, Set<string>>();
  for (const j of journal) tagged.set(j.stockMoveId, new Set([...(tagged.get(j.stockMoveId) ?? []), ...j.analyticAccounts]));
  return tied.filter((t) => t.analyticAccount !== null && t.stockMoveIds.some((m) => tagged.get(m)?.has(t.analyticAccount!)))
    .map((t) => t.analyticLineId).sort();
}
