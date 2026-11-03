/** Odoo's money for an invoice, read back after the post (NFR-OCI-004: the ledger is the oracle, PMO never recomputes it). */
type Amount = number | string | boolean | null | undefined;

export function centsOf(value: Amount): bigint | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;   // Odoo reports an empty field as `false`
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) return null;
  const n = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return match[1] ? -n : n;
}
export function centsToDecimal(n: bigint): string {
  const abs = n < 0n ? -n : n;
  return `${n < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

export interface MoneyHeader { untaxed: string; tax: string; total: string; outstanding: string }
export type ReadBackFlag =
  | { outcome: 'ok' }
  | { outcome: 'needs-attention'; reason: 'total-mismatch'; sent: string; observed: string }
  | { outcome: 'needs-attention'; reason: 'cost-account-missing'; lineIds: number[] };

/** The whole header or null: a part that is absent, empty or unreadable means none of it is written (FR-OCI-024). */
export function moneyHeader(move: { amount_untaxed?: Amount; amount_tax?: Amount; amount_total?: Amount; amount_residual?: Amount } | null): MoneyHeader | null {
  if (!move) return null;
  const [untaxed, tax, total, outstanding] = [move.amount_untaxed, move.amount_tax, move.amount_total, move.amount_residual].map(centsOf);
  if (untaxed === null || tax === null || total === null || outstanding === null) return null;
  return { untaxed: centsToDecimal(untaxed), tax: centsToDecimal(tax), total: centsToDecimal(total), outstanding: centsToDecimal(outstanding) };
}

/** One smallest currency unit (0.01 on the bed's IDR) is rounding; anything larger is a disagreement. */
export function compareSent(sent: Amount, observed: Amount): 'match' | 'mismatch' {
  const a = centsOf(sent), b = centsOf(observed);
  return a !== null && b !== null && a - b <= 1n && b - a <= 1n ? 'match' : 'mismatch';
}

/** The PMO total against Odoo's: both figures are kept, PMO's stored total is never replaced. */
export function checkTotal(sentTotal: Amount, header: MoneyHeader): ReadBackFlag {
  return compareSent(sentTotal, header.total) === 'match'
    ? { outcome: 'ok' }
    : { outcome: 'needs-attention', reason: 'total-mismatch', sent: String(sentTotal), observed: header.total };
}

interface ReadLine { id: number; display_type?: string; analytic_distribution?: Record<string, number> | false | null }

/** Every posted product line must carry the project's cost account at 100% (FR-OCI-022a). No project: nothing to check. */
export function checkCostAccount(lines: readonly ReadLine[] | null, costAccountId: number | null): ReadBackFlag | { outcome: 'unreadable' } {
  if (costAccountId === null) return { outcome: 'ok' };
  const product = (lines ?? []).filter((l) => l.display_type === 'product');
  if (product.length === 0) return { outcome: 'unreadable' };
  const missing = product.filter((l) => !l.analytic_distribution || l.analytic_distribution[String(costAccountId)] !== 100 || Object.keys(l.analytic_distribution).length !== 1);
  return missing.length === 0 ? { outcome: 'ok' } : { outcome: 'needs-attention', reason: 'cost-account-missing', lineIds: missing.map((l) => l.id) };
}
