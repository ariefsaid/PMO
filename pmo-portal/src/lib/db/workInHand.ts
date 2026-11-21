import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { WipInputRow, WipWindowMonth } from '@/src/lib/workInHand';

/**
 * Work in hand read (#2575, migration 1060, `get_work_in_hand`). One security-invoker call returns the whole page's rows as
 * one JSON value; the caller's RLS is the tenancy boundary and org_id is never sent. Money arrives as scale-two text. Every
 * figure is validated: a missing or non-text one is an ERROR, never a plausible 0 (as in db/workOrderBilling.ts).
 */
export interface WorkInHandNoValueContract {
  projectId: string;
  name: string;
  code: string | null;
  status: string;
  currency: string;
}
export interface WorkInHand {
  /** The organisation's calendar date the figures are as of. */
  asOf: string;
  timezone: string;
  orgCurrency: string;
  windowFrom: string;
  windowTo: string;
  truncated: boolean;
  undatedInvoiceCount: number;
  noValueContractCount: number;
  noValue: WorkInHandNoValueContract[];
  /** Valued contracts and Issued work orders, as inputs to `deriveWorkInHand`. */
  rows: WipInputRow[];
}

const MALFORMED = 'work-in-hand-malformed';
const fail = (what: string): never => { throw new AppError(`Work in hand: ${what} is missing or malformed`, MALFORMED); };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, f: string): string => (typeof v === 'string' && v !== '' ? v : fail(f));
const strOrNull = (v: unknown, f: string): string | null => (v === null || v === undefined ? null : typeof v === 'string' ? v : fail(f));
const bool = (v: unknown, f: string): boolean => (typeof v === 'boolean' ? v : fail(f));
const count = (v: unknown, f: string): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : fail(f));
const money = (v: unknown, f: string): string => (typeof v === 'string' && /^-?[0-9]+(?:\.[0-9]{1,2})?$/.test(v) ? v : fail(f));
const arr = (v: unknown, f: string): unknown[] => (Array.isArray(v) ? v : fail(f));
const rec = (v: unknown, f: string): Rec => (isRec(v) ? v : fail(f));

function months(v: unknown, f: string): WipWindowMonth[] {
  return arr(v, f).map((m) => {
    const r = rec(m, f);
    return { month: str(r.month, `${f}.month`), billed: money(r.billed, `${f}.billed`) };
  });
}

/** The money and month fields shared by contracts and work orders. An incomplete row carries no figures (the database sends none). */
function figures(r: Rec, f: string) {
  const incomplete = bool(r.incomplete, `${f}.incomplete`);
  return {
    incomplete,
    foreignCurrencyInvoiceCount: count(r.foreign_currency_invoice_count, `${f}.foreign_currency_invoice_count`),
    unpricedInvoiceCount: count(r.unpriced_invoice_count, `${f}.unpriced_invoice_count`),
    billedToDate: incomplete ? null : money(r.billed_to_date, `${f}.billed_to_date`),
    firstBillingMonth: incomplete ? null : strOrNull(r.first_billing_month, `${f}.first_billing_month`),
    windowMonths: incomplete ? [] : months(r.window_months, `${f}.window_months`),
  };
}

export function parseWorkInHand(data: unknown): WorkInHand {
  const d = rec(data, 'response');
  const contracts = arr(d.contracts, 'contracts').map((c, i): WipInputRow => {
    const r = rec(c, `contracts[${i}]`);
    return {
      kind: 'contract', parentId: null,
      id: str(r.project_id, 'project_id'),
      name: str(r.name, 'name'),
      code: strOrNull(r.pmo_project_number, 'pmo_project_number') ?? strOrNull(r.code, 'code'),
      status: str(r.status, 'status'),
      currency: str(r.currency, 'currency'),
      value: money(r.contract_net, 'contract_net'),
      ...figures(r, `contracts[${i}]`),
    };
  });
  const workOrders = arr(d.work_orders, 'work_orders').map((w, i): WipInputRow => {
    const r = rec(w, `work_orders[${i}]`);
    return {
      kind: 'workOrder',
      id: str(r.work_order_id, 'work_order_id'),
      parentId: str(r.project_id, 'project_id'),
      name: str(r.title, 'title'),
      code: strOrNull(r.wo_number, 'wo_number'),
      status: str(r.status, 'status'),
      currency: str(r.currency, 'currency'),
      value: money(r.order_net, 'order_net'),
      ...figures(r, `work_orders[${i}]`),
    };
  });
  const noValue = arr(d.no_value, 'no_value').map((c, i): WorkInHandNoValueContract => {
    const r = rec(c, `no_value[${i}]`);
    return {
      projectId: str(r.project_id, 'project_id'), name: str(r.name, 'name'),
      code: strOrNull(r.pmo_project_number, 'pmo_project_number') ?? strOrNull(r.code, 'code'),
      status: str(r.status, 'status'), currency: str(r.currency, 'currency'),
    };
  });
  return {
    asOf: str(d.as_of, 'as_of'),
    timezone: str(d.timezone, 'timezone'),
    orgCurrency: str(d.org_currency, 'org_currency'),
    windowFrom: str(d.window_from, 'window_from'),
    windowTo: str(d.window_to, 'window_to'),
    truncated: bool(d.truncated, 'truncated'),
    undatedInvoiceCount: count(d.undated_invoice_count, 'undated_invoice_count'),
    noValueContractCount: noValue.length,
    noValue,
    rows: [...contracts, ...workOrders],
  };
}

/** Left to bill inputs for every contract on hand and Issued work order (Admin, Executive, Finance only; refused otherwise). */
export async function getWorkInHand(asOf?: string): Promise<WorkInHand> {
  const { data, error } = await supabase.rpc('get_work_in_hand', asOf ? { p_as_of: asOf } : {});
  if (error) throw new AppError(error.message, error.code);
  return parseWorkInHand(data);
}
