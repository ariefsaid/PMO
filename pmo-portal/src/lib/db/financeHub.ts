import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/**
 * #1988 — the Finance hub's three figures in ONE narrow invoker RPC (`get_finance_hub_figures`,
 * 0762): the per-currency unbilled figure (earned, not yet invoiced) with the pack's contract-row
 * counts, and the latest company P&L net profit. The server derives both from the same data the
 * full reads (`get_management_pack`, `get_financial_statement`) produce — pgTAP proves the figures
 * equal those reads on the same data — so the hub no longer fetches the whole pack or statement.
 */

export interface FinanceHubUnbilledCurrency {
  currency: string;
  /** Whole amount NET of tax, integer cents, in the row's own currency (NFR-MMP-002). */
  cents: number;
}

export interface FinanceHubPackFigures {
  /** `YYYY-MM-01`, the pack's as-at month (its `to`). */
  asAt: string;
  /** One entry per currency the pack's totals carry — including zero unbilled ones. */
  unbilled: FinanceHubUnbilledCurrency[];
  contractRows: number;
  /** Contract rows with no progress entry at or before `asAt` (the hub's invoiced-basis count). */
  invoicedBasisRows: number;
}

export interface FinanceHubStatementFigures {
  /** True when the org has no statement rows at all (the hub's integrations pointer). */
  unpublished: boolean;
  /** `YYYY-MM-DD`, the latest month period at or before today; null when there is none. */
  periodStart: string | null;
  /** Profit for the period from the latest company P&L; null when it cannot be read. */
  netProfit: number | null;
  /** The statement snapshot's currency (the read envelope's generation currency). */
  currency: string | null;
}

export interface FinanceHubFigures {
  pack: FinanceHubPackFigures;
  statement: FinanceHubStatementFigures;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function integerFigure(value: unknown): value is number {
  return finiteNumber(value) && Number.isInteger(value);
}

function isoDayOrNull(value: unknown): string | null {
  if (value === null) return null;
  return typeof value === 'string' && DATE.test(value) ? value : null;
}

/** Narrow the RPC's jsonb to the figures shape. A malformed body is an error, never a zero. */
export function parseFinanceHubFigures(data: unknown): FinanceHubFigures {
  const d = data as Record<string, unknown> | null;
  const ok =
    d != null &&
    typeof d === 'object' &&
    d.pack != null && typeof d.pack === 'object' &&
    d.statement != null && typeof d.statement === 'object';
  if (!ok) throw new AppError('The finance hub figures response was malformed', 'hub-figures-malformed');
  const wirePack = d.pack as Record<string, unknown>;
  const wireStatement = d.statement as Record<string, unknown>;
  const unbilled = wirePack.unbilled;
  if (
    typeof wirePack.as_at !== 'string' || !DATE.test(wirePack.as_at) ||
    !Array.isArray(unbilled) ||
    !unbilled.every((entry) => {
      const e = entry as Record<string, unknown> | null;
      return e != null && typeof e === 'object' &&
        typeof e.currency === 'string' && e.currency.length > 0 && integerFigure(e.cents);
    }) ||
    !integerFigure(wirePack.contract_rows) || !integerFigure(wirePack.invoiced_basis_rows) ||
    typeof wireStatement.unpublished !== 'boolean' ||
    !('period_start' in wireStatement) || !('net_profit' in wireStatement) || !('currency' in wireStatement) ||
    !(wireStatement.period_start === null || (typeof wireStatement.period_start === 'string' && DATE.test(wireStatement.period_start))) ||
    !(wireStatement.net_profit === null || finiteNumber(wireStatement.net_profit)) ||
    !(wireStatement.currency === null || (typeof wireStatement.currency === 'string' && wireStatement.currency.length > 0))
  ) {
    throw new AppError('The finance hub figures response was malformed', 'hub-figures-malformed');
  }
  return {
    pack: {
      asAt: wirePack.as_at,
      unbilled: (unbilled as Array<{ currency: string; cents: number }>).map(({ currency, cents }) => ({ currency, cents })),
      contractRows: wirePack.contract_rows,
      invoicedBasisRows: wirePack.invoiced_basis_rows,
    },
    statement: {
      unpublished: wireStatement.unpublished,
      periodStart: isoDayOrNull(wireStatement.period_start),
      netProfit: wireStatement.net_profit === null ? null : (wireStatement.net_profit as number),
      currency: wireStatement.currency === null ? null : (wireStatement.currency as string),
    },
  };
}

export async function getFinanceHubFigures(): Promise<FinanceHubFigures> {
  const { data, error } = await supabase.rpc('get_finance_hub_figures');
  if (error) throw new AppError(error.message, error.code);
  return parseFinanceHubFigures(data);
}
