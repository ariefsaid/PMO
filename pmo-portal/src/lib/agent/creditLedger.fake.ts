/**
 * In-memory stand-in for the credit RPCs (`org_credit_balance`, `reserve_credits`, `release_credits`).
 * Mirrors the SQL contract (migration 0077): a reserve succeeds only while balance minus the open
 * holds still covers the amount; otherwise it raises 23514. The body runs synchronously, so — like
 * the per-org advisory lock — concurrent reserves are serialized.
 */
import { vi } from 'vitest';

export interface CreditLedgerFake {
  rpc: ReturnType<typeof vi.fn>;
  /** run ids with an unreleased hold */
  openHolds(): string[];
  calls(fn: string): Array<Record<string, unknown>>;
}

export function makeCreditLedger(
  balance: number,
  opts: { reserveError?: { code: string } } = {},
): CreditLedgerFake {
  const holds = new Map<string, number>();
  const log: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    log.push({ fn, args });
    if (fn === 'org_credit_balance') return { data: balance, error: null };
    if (fn === 'reserve_credits') {
      if (opts.reserveError) return { data: null, error: opts.reserveError };
      const held = [...holds.values()].reduce((a, b) => a + b, 0);
      const amount = args.p_amount as number;
      if (balance - held < amount) return { data: null, error: { code: '23514' } };
      const id = args.p_run_id as string;
      holds.set(id, (holds.get(id) ?? 0) + amount);
      return { data: 'reservation-id', error: null };
    }
    if (fn === 'release_credits') {
      holds.delete(args.p_run_id as string);
      return { data: null, error: null };
    }
    return { data: null, error: { code: 'XX000' } };
  });
  return {
    rpc,
    openHolds: () => [...holds.keys()],
    calls: (fn) => log.filter((c) => c.fn === fn).map((c) => c.args),
  };
}
