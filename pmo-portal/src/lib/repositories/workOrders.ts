/** Delivery implementations: milestones, work orders, progress billing (incl. claim-invoice dispatch), acceptances. */
import { AppError } from '@/src/lib/appError';
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import {
  listMilestones,
  getProjectsDelivery,
  getProjectsDeliverySummary,
  getProjectsMilestoneDates,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  updateTaskMilestone,
} from '@/src/lib/db/milestones';
import {
  listProjectWorkOrders,
  getWorkOrder,
  createWorkOrder,
  updateWorkOrder,
  setWorkOrderValue,
  transitionWorkOrder,
  getProjectDrawdown,
} from '@/src/lib/db/workOrders';
import { listWorkOrderBilling, getUnbilledWorkOrders } from '@/src/lib/db/workOrderBilling';
import {
  listBoqItems,
  createBoqItem,
  updateBoqItem,
  deleteBoqItem,
  recordProgressAssessment,
  listProjectClaims,
  createProgressClaim,
  attachClaimEvidence,
  withdrawProgressClaim,
  getProjectBilling,
} from '@/src/lib/db/progressBilling';
import {
  listProjectAcceptances,
  listWorkOrderLines,
  listProjectWorkOrderLines,
  createWorkOrderLine,
  updateWorkOrderLine,
  deleteWorkOrderLine,
  prepareWorkOrderAcceptance,
  withdrawWorkOrderAcceptance,
  confirmWorkOrderAcceptance,
} from '@/src/lib/db/workOrderAcceptances';
import { wrap } from './repositoryErrors';
import { dispatchCreate } from './repositoryDispatch';
import type { MilestoneRepository, ProgressBillingRepository, WorkOrderAcceptanceRepository, WorkOrderRepository } from './contracts/workOrders';

export const milestoneRepository: MilestoneRepository = {
  list: (projectId) => wrap(() => listMilestones(projectId)),
  deliveryForProjects: (ids) => wrap(() => getProjectsDelivery(ids)),
  deliverySummaryForProjects: (ids) => wrap(() => getProjectsDeliverySummary(ids)),
  milestoneDatesForProjects: (ids) => wrap(() => getProjectsMilestoneDates(ids)),
  create: (input, projectId) => wrap(() => createMilestone(input, projectId)),
  update: (id, patch) => wrap(() => updateMilestone(id, patch)),
  delete: (id) => wrap(() => deleteMilestone(id)),
  setTaskMilestone: (taskId, milestoneId) => wrap(() => updateTaskMilestone(taskId, milestoneId)),
};

/**
 * Work orders (#566). Thin wrappers, deliberately one-to-one with the DAL: `setValue` and
 * `transition` stay SEPARATE from `update` because the server keeps them separate — the value and
 * its tax basis move through the sole witnessed writer, and status moves through the single
 * transition authority. Collapsing any pair here would hide a control behind a convenience.
 */
export const workOrderRepository: WorkOrderRepository = {
  list: (projectId) => wrap(() => listProjectWorkOrders(projectId)),
  get: (id) => wrap(() => getWorkOrder(id)),
  create: (projectId, input) => wrap(() => createWorkOrder(projectId, input)),
  update: (id, patch) => wrap(() => updateWorkOrder(id, patch)),
  setValue: (input) => wrap(() => setWorkOrderValue(input)),
  transition: (id, to, opts) => wrap(() => transitionWorkOrder(id, to, opts)),
  drawdown: (projectId) => wrap(() => getProjectDrawdown(projectId)),
  billing: (projectId) => wrap(() => listWorkOrderBilling(projectId)),
  unbilled: (limit) => wrap(() => getUnbilledWorkOrders(limit)),
};

/**
 * Progress billing (#766). Assessments are operational and never dispatch. Raising a billing claim's invoice
 * dispatches a sales-invoice CREATE whose record id is the CLAIM id, so the outbox's one-in-flight-per-record
 * rule makes a claim mint at most one ERP invoice. The body is built server-side from the claim.
 */
export const progressBillingRepository: ProgressBillingRepository = {
  listBoq: (projectId) => wrap(() => listBoqItems(projectId)),
  createBoq: (projectId, input) => wrap(() => createBoqItem(projectId, input)),
  updateBoq: (id, input) => wrap(() => updateBoqItem(id, input)),
  deleteBoq: (id) => wrap(() => deleteBoqItem(id)),
  recordAssessment: (input) => wrap(() => recordProgressAssessment(input)),
  listClaims: (projectId) => wrap(() => listProjectClaims(projectId)),
  createClaim: (input) => wrap(() => createProgressClaim(input)),
  attachEvidence: (claimId, documentId) => wrap(() => attachClaimEvidence(claimId, documentId)),
  withdrawClaim: (id) => wrap(() => withdrawProgressClaim(id)),
  raiseInvoice: (claim, intent) =>
    routeDomainWrite('revenue') === 'external'
      ? dispatchCreate(
          'revenue',
          { erp_doc_kind: 'sales-invoice', projectId: claim.projectId, customerId: claim.customerId },
          { id: claim.claimId, idempotencyKey: intent?.idempotencyKey ?? crypto.randomUUID() },
        ).then((res) => ({ id: String(res.canonical.id), si_number: String(res.canonical.si_number ?? '') }))
      : Promise.reject(new AppError('revenue is not enabled for this org', 'revenue-not-enabled')),
  summary: (projectId) => wrap(() => getProjectBilling(projectId)),
};

/** Contract quantities (ADR-0091): allocations and BAST acceptances. Operational only — never dispatches to an ERP. */
export const workOrderAcceptanceRepository: WorkOrderAcceptanceRepository = {
  listByProject: (projectId) => wrap(() => listProjectAcceptances(projectId)),
  listLines: (workOrderId) => wrap(() => listWorkOrderLines(workOrderId)),
  listProjectLines: (projectId) => wrap(() => listProjectWorkOrderLines(projectId)),
  createLine: (input) => wrap(() => createWorkOrderLine(input)),
  updateLine: (id, quantity) => wrap(() => updateWorkOrderLine(id, quantity)),
  deleteLine: (id) => wrap(() => deleteWorkOrderLine(id)),
  prepare: (input) => wrap(() => prepareWorkOrderAcceptance(input)),
  withdraw: (id) => wrap(() => withdrawWorkOrderAcceptance(id)),
  confirm: (id) => wrap(() => confirmWorkOrderAcceptance(id)),
};
