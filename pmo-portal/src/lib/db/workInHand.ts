import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
import { parseExactCents } from '@/src/lib/exactDecimal';
import { wireValidator, type WireRecord } from '@/src/lib/wireDoc';
import type { WipInputRow, WipWindowMonth } from '@/src/lib/workInHand';
import { readOrgColumns } from './orgSettingsBatch';

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
  /** Admin-configured monthly production capacity in `orgCurrency` (scale-two text), or null when unset. */
  monthlyCapacity?: string | null;
  windowFrom: string;
  windowTo: string;
  truncated: boolean;
  undatedInvoiceCount: number;
  noValueContractCount: number;
  noValue: WorkInHandNoValueContract[];
  /** Valued contracts and Issued work orders, as inputs to `deriveWorkInHand`. */
  rows: WipInputRow[];
}

const v = wireValidator('Work in hand', 'work-in-hand-malformed');
const { str, strOrNull, bool, money, moneyOrNull, arr, rec } = v;
const count = (val: unknown, f: string): number => v.int(val, f, { min: 0 });

function months(val: unknown, f: string): WipWindowMonth[] {
  return arr(val, f).map((m) => {
    const r = rec(m, f);
    return { month: str(r.month, `${f}.month`), billed: money(r.billed, `${f}.billed`) };
  });
}

/** The money and month fields shared by contracts and work orders. An incomplete row carries no figures (the database sends none). */
function figures(r: WireRecord, f: string) {
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
    monthlyCapacity: moneyOrNull(d.monthly_capacity, 'monthly_capacity'),
    windowFrom: str(d.window_from, 'window_from'),
    windowTo: str(d.window_to, 'window_to'),
    truncated: bool(d.truncated, 'truncated'),
    undatedInvoiceCount: count(d.undated_invoice_count, 'undated_invoice_count'),
    noValueContractCount: noValue.length,
    noValue,
    rows: [...contracts, ...workOrders],
  };
}

export type MonthlyCapacityIssue = 'invalid' | 'positive' | 'precision';

/** Shared capacity validation matching the database check constraint (> 0, at most two decimal places) without float rounding. */
export function monthlyCapacityIssue(value: string | number | null): MonthlyCapacityIssue | null {
  if (value === null) return null;
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'invalid';
    if (value <= 0) return 'positive';
    text = String(value);
    if (/[eE]/.test(text)) return 'precision';
  } else {
    text = value.trim();
    if (text === '') return null;
  }
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return 'invalid';
  if (text.startsWith('-') || /^0+(?:\.0+)?$/.test(text)) return 'positive';
  const cents = parseExactCents(text);
  if (cents === null) return 'precision';
  return cents <= 0n ? 'positive' : null;
}

/** Left to bill inputs for every contract on hand and Issued work order (Admin, Executive, Finance, and PM for assigned projects). */
export async function getWorkInHand(asOf?: string): Promise<WorkInHand> {
  const { data, error } = await supabase.rpc('get_work_in_hand', asOf ? { p_as_of: asOf } : {});
  if (error) throw new AppError(error.message, error.code);
  return parseWorkInHand(data);
}

/** Reads the organisation's monthly capacity setting (in org currency) under RLS; `org_id` is never sent. */
export async function getWorkInHandMonthlyCapacity(): Promise<number | null> {
  const { data, error } = await readOrgColumns(['work_in_hand_monthly_capacity']);
  if (error) throw new AppError(error.message, error.code);
  const value = data?.work_in_hand_monthly_capacity;
  return value === null || value === undefined ? null : Number(value);
}

/**
 * Sets or clears (`null`) the organisation's monthly capacity in the organisation's currency.
 * Enforced in Postgres by the Admin-only `organizations_update_work_in_hand_capacity` policy and column grant.
 */
export async function setWorkInHandMonthlyCapacity(value: number | null): Promise<void> {
  const issue = monthlyCapacityIssue(value);
  if (issue === 'invalid') throw new AppError('Enter a valid amount.', '22023');
  if (issue === 'positive') throw new AppError('Monthly capacity must be greater than zero.', '22023');
  if (issue === 'precision') throw new AppError('Give monthly capacity at most two decimals.', '22023');
  const { data, error } = await supabase.from('organizations').select('id').limit(2);
  if (error) throw new AppError(error.message, error.code);
  if ((data?.length ?? 0) > 1) {
    throw new AppError('More than one organization is readable; refusing to guess which one to change.', '22023');
  }
  const orgId = data?.[0]?.id;
  if (!orgId) throw new AppError('No organization is readable for the current user.', '42501');
  const { data: changed, error: updateError } = await supabase
    .from('organizations')
    .update({ work_in_hand_monthly_capacity: value })
    .eq('id', orgId)
    .select('id');
  if (updateError) throw new AppError(updateError.message, updateError.code);
  assertWriteLanded(changed, 'Only an Admin can change monthly work capacity.');
}
