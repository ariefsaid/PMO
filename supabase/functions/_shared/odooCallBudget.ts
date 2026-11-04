import type { OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';

export interface OdooCallBudget {
  left: () => boolean;
  spend: () => boolean;
}

/** Spend one sweep tick unit before each Odoo RPC; an exhausted budget never reaches the network. */
export function withOdooCallBudget(call: OdooCall, budget?: OdooCallBudget): OdooCall {
  if (!budget) return call;
  return async <T>(model: string, method: string, body?: Record<string, unknown>): Promise<T> => {
    if (!budget.spend()) throw new Error('Odoo recovery call budget exhausted');
    return call<T>(model, method, body);
  };
}
