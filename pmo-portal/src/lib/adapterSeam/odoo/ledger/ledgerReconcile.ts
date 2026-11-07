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
