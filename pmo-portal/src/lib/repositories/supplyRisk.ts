import { toAppError } from '@/src/lib/appError';
import * as dal from '@/src/lib/db/supplyRisk';
import type { SupplyRiskRepository } from './contracts/supplyRisk';

async function wrap<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (error) { throw toAppError(error); }
}

export const supplyRiskRepository: SupplyRiskRepository = {
  suggestion: (companyId) => wrap(() => dal.getSupplyRiskSuggestion(companyId)),
  exposure: (companyId) => wrap(() => dal.listExposedWorkOrders(companyId)),
  setStatus: (companyId, status, reason) => wrap(() => dal.setSupplyRiskStatus(companyId, status, reason)),
  setterName: (profileId) => wrap(() => dal.getSupplyRiskSetterName(profileId)),
  warnings: (scope) => wrap(() => dal.listSupplyRiskWarnings(scope)),
};
