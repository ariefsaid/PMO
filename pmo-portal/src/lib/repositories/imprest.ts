/** Site imprest repository (#1515, ADR-0017): the API seam over the imprest DAL. Thin by design: the RPCs hold every rule. */
import * as dal from '@/src/lib/db/imprest';
import { wrap } from './repositoryErrors';
import type { ImprestRepository } from './contracts/imprest';

export const imprestRepository: ImprestRepository = {
  listFloats: () => wrap(() => dal.listFloats()),
  getPosition: (floatId) => wrap(() => dal.getPosition(floatId)),
  getPlanUsage: (floatId, month) => wrap(() => dal.getPlanUsage(floatId, month)),
  floatChoices: (projectId, category) => wrap(() => dal.floatChoices(projectId, category)),
  listPlans: (floatId) => wrap(() => dal.listPlans(floatId)),
  listPlanLines: (planId) => wrap(() => dal.listPlanLines(planId)),
  listReplenishments: (floatId) => wrap(() => dal.listReplenishments(floatId)),
  listCounts: (floatId) => wrap(() => dal.listCounts(floatId)),
  createPlan: (floatId, month) => wrap(() => dal.createPlan(floatId, month)),
  savePlanLine: (planId, category, amount) => wrap(() => dal.savePlanLine(planId, category, amount)),
  deletePlanLine: (lineId) => wrap(() => dal.deletePlanLine(lineId)),
  setProcurementLimit: async (amount) => { await wrap(() => dal.setProcurementLimit(amount)); },
  establishFloat: (projectId, custodianId, amount) => wrap(() => dal.establishFloat(projectId, custodianId, amount)),
  proposeFloatAmount: (floatId, amount) => wrap(() => dal.proposeFloatAmount(floatId, amount)),
  decideFloatChange: async (changeId, approve, notes) => { await wrap(() => dal.decideFloatChange(changeId, approve, notes)); },
  transitionPlan: async (planId, to, notes) => { await wrap(() => dal.transitionPlan(planId, to, notes)); },
  requestReplenishment: (floatId, kind) => wrap(() => dal.requestReplenishment(floatId, kind)),
  transitionReplenishment: async (id, to, opts) => { await wrap(() => dal.transitionReplenishment(id, to, opts)); },
  recordCount: (floatId, counted, note) => wrap(() => dal.recordCount(floatId, counted, note)),
};
