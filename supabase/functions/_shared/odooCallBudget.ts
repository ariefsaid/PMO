import type { OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { AdapterError } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';

export interface OdooCallBudget {
  left: () => boolean;
  spend: (calls?: number) => boolean;
}

export interface ReservedOdooCallBudget extends OdooCallBudget {
  exhausted: () => boolean;
}

/** A per-candidate guard backed by capacity the tick reserved before it began recovery. */
export function reservedOdooCallBudget(calls: number): ReservedOdooCallBudget {
  let remaining = calls;
  let exhausted = false;
  const left = () => remaining > 0;
  return {
    left,
    spend: (units = 1) => {
      if (!Number.isInteger(units) || units < 0 || units > remaining) {
        exhausted = true;
        return false;
      }
      remaining -= units;
      return true;
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
