/** Site imprest repository contract (#1515). One-to-one with the DAL: the RPCs hold every rule. */
import type * as dal from '@/src/lib/db/imprest';

export interface ImprestRepository {
  listFloats: typeof dal.listFloats;
  getFloat: typeof dal.getFloat;
  getPosition: typeof dal.getPosition;
  getPlanUsage: typeof dal.getPlanUsage;
  floatChoices: typeof dal.floatChoices;
  listPlans: typeof dal.listPlans;
  listPlanLines: typeof dal.listPlanLines;
  listReplenishments: typeof dal.listReplenishments;
  listCounts: typeof dal.listCounts;
  listPostingStates: typeof dal.listPostingStates;
  setCashAccount: (floatId: string, account: string) => Promise<void>;
  listFloatChanges: typeof dal.listFloatChanges;
  listFloatClaims: typeof dal.listFloatClaims;
  listAwaitingImprest: typeof dal.listAwaitingImprest;
  getProcurementLimit: typeof dal.getProcurementLimit;
  setClaimFloat: typeof dal.setClaimFloat;
  createPlan: typeof dal.createPlan;
  savePlanLine: typeof dal.savePlanLine;
  deletePlanLine: typeof dal.deletePlanLine;
  setProcurementLimit: (amount: number) => Promise<void>;
  establishFloat: typeof dal.establishFloat;
  proposeFloatAmount: typeof dal.proposeFloatAmount;
  decideFloatChange: (changeId: string, approve: boolean, notes?: string) => Promise<void>;
  transitionPlan: (planId: string, to: Parameters<typeof dal.transitionPlan>[1], notes?: string) => Promise<void>;
  requestReplenishment: typeof dal.requestReplenishment;
  transitionReplenishment: (id: string, to: Parameters<typeof dal.transitionReplenishment>[1],
                            opts?: { notes?: string; paymentReference?: string }) => Promise<void>;
  recordCount: typeof dal.recordCount;
}
