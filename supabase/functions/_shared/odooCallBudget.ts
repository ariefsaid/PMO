import type { OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { AdapterError } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';

export interface OdooCallBudget {
  left: () => boolean;
  spend: (calls?: number) => boolean;
  canSpend?: (calls?: number) => boolean;
  refund?: (calls?: number) => void;
}

export interface ReservedOdooCallBudget extends OdooCallBudget {
  exhausted: () => boolean;
  used: () => number;
  /** Counts adapter traffic without refusing it, so a money commit is never cut mid-flight. */
  record: () => void;
}

/** A per-candidate guard backed by capacity reserved after its recovery dependencies are built. */
export function reservedOdooCallBudget(calls: number): ReservedOdooCallBudget {
  let used = 0;
  let exhausted = false;
  const canSpend = (units = 1) => Number.isInteger(units) && units >= 0 && used + units <= calls;
  const spend = (units = 1) => {
    if (!canSpend(units)) {
      exhausted = true;
      return false;
    }
    used += units;
    return true;
  };
  return {
    left: () => used < calls,
    canSpend,
    spend,
    used: () => used,
    record: () => {
      used += 1;
      if (used > calls) exhausted = true;
    },
    exhausted: () => exhausted,
  };
}

/** Guard a candidate's actual Odoo calls against its already-reserved tick allowance. */
export function withOdooCallBudget(call: OdooCall, budget?: OdooCallBudget): OdooCall {
  if (!budget) return call;
  return async <T>(model: string, method: string, body?: Record<string, unknown>): Promise<T> => {
    if (!budget.spend()) throw new AdapterError('external-unreachable', 'recovery-call-budget-exhausted');
    return call<T>(model, method, body);
  };
}

/** Count Odoo calls owned by an adapter while always allowing each call to finish. */
export function countOdooCalls(call: OdooCall, budget?: Pick<ReservedOdooCallBudget, 'record'>): OdooCall {
  if (!budget) return call;
  return <T>(model: string, method: string, body?: Record<string, unknown>): Promise<T> => {
    budget.record();
    return call<T>(model, method, body);
  };
}
