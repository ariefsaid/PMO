import * as dal from '@/src/lib/db/subcontracts';
import type { SubcontractRepository } from './types';

export const subcontractRepository: SubcontractRepository = {
  async getPoPosition(poId: string) {
    const rows = await dal.getPoPosition(poId);
    if (rows.length >= 1000) {
      throw new Error('subcontract position truncated');
    }
    return rows;
  },
  listPoRevisions: (poId: string) => dal.listPoRevisions(poId),
  listPoLines: (poId: string, revision?: number) => dal.listPoLines(poId, revision),
  setPoLines: (poId: string, lines: dal.SetPoLinesInput[]) => dal.setPoLines(poId, lines),
  issuePoLines: (poId: string) => dal.issuePoLines(poId),
  listSubcontractAcceptances: (poId: string) => dal.listSubcontractAcceptances(poId),
  prepareSubcontractAcceptance: (input: dal.PrepareSubcontractAcceptanceInput) => dal.prepareSubcontractAcceptance(input),
  confirmSubcontractAcceptance: (id: string) => dal.confirmSubcontractAcceptance(id),
  withdrawSubcontractAcceptance: (id: string) => dal.withdrawSubcontractAcceptance(id),
  listPoVariations: (poId: string) => dal.listPoVariations(poId),
  requestPoVariation: (input: dal.RequestPoVariationInput) => dal.requestPoVariation(input),
  decidePoVariation: (id: string, approve: boolean, notes?: string | null) => dal.decidePoVariation(id, approve, notes),
  issuePoRevision: (variationId: string) => dal.issuePoRevision(variationId),
  linkPoVariation: (variationId: string, workOrderId: string | null, reason: string | null) =>
    dal.linkPoVariation(variationId, workOrderId, reason),
  getVariationRoute: (variationId: string) => dal.getVariationRoute(variationId),
  getProjectSubcontractExposure: (projectId: string) => dal.getProjectSubcontractExposure(projectId),
  listWorkOrderCostVariations: (workOrderId: string) => dal.listWorkOrderCostVariations(workOrderId),
  listSubcontractCapExceptions: (procurementId: string) => dal.listSubcontractCapExceptions(procurementId),
  attributeSubcontractBillLines: (invoiceId: string, lines: dal.AttributeSubcontractBillLineInput[]) =>
    dal.attributeSubcontractBillLines(invoiceId, lines),
};
