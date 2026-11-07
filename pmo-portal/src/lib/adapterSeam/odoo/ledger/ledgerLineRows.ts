/**
 * Odoo ledger line → mirror rows (DD-ODA-1/2, FR-ODA-002/003/005). One row per (line × linked project account) plus one
 * unattributed row for the rest, so the rows of a line sum to its debit and credit exactly. PMO splits `debit`/`credit`
 * by the stored percentage; the last row absorbs the rounding remainder. Pure: no I/O, no float.
 */
import { divRound, formatCents, nanoToCents, toNano } from './cents.ts';

/** Analytic account id → the PMO projects that link it. Linked means exactly one claimant. */
export type ProjectAccounts = ReadonlyMap<string, readonly string[]>;

export interface LedgerLine {
  id: number;
  moveName: string;
  journal: string | null;
  date: string;
  /** The account code (resolved by the caller from the account mirror). */
  account: string;
  partner: string | null;
  debit: string | number;
  credit: string | number;
  parentState: string;
  /** Odoo's `analytic_distribution`: `{ "<id>" | "<id>,<id>": percent }`, or false/null when absent. */
  distribution: Readonly<Record<string, number>> | false | null;
  foreignCurrency: boolean;
  writeDate: string;
}

export interface LedgerRow {
  erp_name: string;
  voucher_type: 'account.move';
  voucher_no: string;
  account: string;
  /** Analytic account id as text, or null for the unattributed row. */
  project: string | null;
  debit: string;
  credit: string;
  posting_date: string;
  is_cancelled: boolean;
  foreign_currency: boolean;
  journal: string | null;
  partner: string | null;
  source_write_date: string;
}

const HUNDRED = 100n * 1_000_000_000n;

/** The project account a distribution key attributes to, or null (unknown, ambiguous, or two project accounts). */
export function parseDistributionKey(key: string, accounts: ProjectAccounts): string | null {
  const ids = key.split(',');
  if (!ids.every((id) => /^\d+$/.test(id))) return null;
  const hits = ids.filter((id) => accounts.has(id));
  return hits.length === 1 && accounts.get(hits[0])!.length === 1 ? hits[0] : null;
}

/** Percentage shares per project id (null = unattributed), in first-seen order with the unattributed share last. */
function shares(distribution: LedgerLine['distribution'], accounts: ProjectAccounts): Array<[string | null, bigint]> {
  const byProject = new Map<string | null, bigint>();
  let total = 0n;
  for (const [key, pct] of Object.entries(distribution || {})) {
    const p = toNano(pct);
    if (p === null || p < 0n) return [[null, HUNDRED]];
    total += p;
    const id = parseDistributionKey(key, accounts);
    byProject.set(id, (byProject.get(id) ?? 0n) + p);
  }
  // Over 100% cannot be split exactly; show the whole line unattributed rather than invent a split.
  if (total > HUNDRED) return [[null, HUNDRED]];
  const unattributed = (byProject.get(null) ?? 0n) + HUNDRED - total;
  byProject.delete(null);
  const out = [...byProject.entries()];
  if (unattributed > 0n) out.push([null, unattributed]);
  return out;
}

/** Split one amount (cents) across the shares; the last share takes the remainder. */
function split(cents: bigint, pcts: bigint[]): bigint[] {
  const out: bigint[] = [];
  let used = 0n;
  pcts.forEach((p, i) => {
    const part = i === pcts.length - 1 ? cents - used : divRound(cents * p, HUNDRED);
    out.push(part);
    used += part;
  });
  return out;
}

export function fanOutLine(line: LedgerLine, accounts: ProjectAccounts): LedgerRow[] {
  const debit = toNano(line.debit), credit = toNano(line.credit);
  if (debit === null || credit === null) throw new Error(`ledger line ${line.id}: malformed amount`);
  const parts = shares(line.distribution, accounts);
  const pcts = parts.map(([, p]) => p);
  const debits = split(nanoToCents(debit), pcts), credits = split(nanoToCents(credit), pcts);
  return parts.map(([project], i) => ({
    erp_name: `odoo:${line.id}:${project ?? '-'}`,
    voucher_type: 'account.move',
    voucher_no: line.moveName,
    account: line.account,
    project,
    debit: formatCents(debits[i]),
    credit: formatCents(credits[i]),
    posting_date: line.date,
    is_cancelled: line.parentState !== 'posted',
    foreign_currency: line.foreignCurrency,
    journal: line.journal,
    partner: line.partner,
    source_write_date: line.writeDate,
  }));
}
