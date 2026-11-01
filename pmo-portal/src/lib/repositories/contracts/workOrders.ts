/** Delivery contracts: milestones, work orders, progress billing, acceptances. */
import type { CommandIntent } from './commandIntent';
import type {
  BoqItemInput,
  BoqItemRow,
  ProgressAssessmentInput,
  ProgressClaimInput,
  ProgressClaimWithInvoice,
} from '@/src/lib/db/progressBilling';
import type {
  ConfirmWorkOrderAcceptanceResult,
  PrepareWorkOrderAcceptanceInput,
  WorkOrderAcceptanceWithLines,
  WorkOrderLineInput,
  WorkOrderLineRow,
} from '@/src/lib/db/workOrderAcceptances';
import type { ProjectBillingFacts } from '@/src/lib/progressBilling';
import type {
  WorkOrderRow,
  WorkOrderStatus,
  WorkOrderInput,
  WorkOrderPatch,
  SetWorkOrderValueInput,
  ProjectDrawdown,
} from '@/src/lib/db/workOrders';
import type { WorkOrderAcceptanceAge, WorkOrderBillingRow, UnbilledWorkOrders } from '@/src/lib/db/workOrderBilling';
import type {
  MilestoneRow,
  MilestoneWithProgress,
  MilestoneInput,
  MilestonePatch,
  ProjectDeliverySummary,
  MilestoneDate,
} from '@/src/lib/db/milestones';

export interface MilestoneRepository {
  list: (projectId: string) => Promise<MilestoneWithProgress[]>;
  deliveryForProjects: (ids: string[]) => Promise<Record<string, number>>;
  deliverySummaryForProjects: (ids: string[]) => Promise<Record<string, ProjectDeliverySummary>>;
  /** Dated milestones for a set of projects — the read-only calendar view (one batched read). */
  milestoneDatesForProjects: (ids: string[]) => Promise<MilestoneDate[]>;
  create: (input: MilestoneInput, projectId: string) => Promise<MilestoneRow>;
  update: (id: string, patch: MilestonePatch) => Promise<void>;
  delete: (id: string) => Promise<void>;
  setTaskMilestone: (taskId: string, milestoneId: string | null) => Promise<void>;
}

/**
 * Work orders (#566) — the CLIENT's inbound PO drawing down against a project's committed ceiling.
 *
 * ⚑ The asymmetry is the contract, not an accident: `create` and `update` are table writes over
 * two DIFFERENT granted column lists, while the value+basis and every status move go through
 * security-definer RPCs. A future ERP-backed implementation must preserve the same split — folding
 * `setValue` into `update` would discard the witness the issue SoD reads.
 */
export interface WorkOrderRepository {
  list(projectId: string): Promise<WorkOrderRow[]>;
  get(id: string): Promise<WorkOrderRow | null>;
  create(projectId: string, input: WorkOrderInput): Promise<WorkOrderRow>;
  /** Body only — never the value or its tax basis (0197 §5(a) revoked those from the grant). */
  update(id: string, patch: WorkOrderPatch): Promise<void>;
  /** The value AND the basis that describes it, in one witnessed call. */
  setValue(input: SetWorkOrderValueInput): Promise<void>;
  /** Status moves; `overCommitAck` is sent only for an issue that actually exceeds the ceiling. */
  transition(id: string, to: WorkOrderStatus, opts?: { overCommitAck?: boolean }): Promise<void>;
  /** The derived drawdown, or null when the project is invisible/absent (never a fabricated zero). */
  drawdown(projectId: string): Promise<ProjectDrawdown | null>;
  /** OD-BILL-1: per-work-order billing for one project (view work_order_billing, RLS-scoped). */
  billing(projectId: string): Promise<WorkOrderBillingRow[]>;
  /** OD-BILL-1 / #786: what is still to invoice across the org's issued and closed work orders. */
  unbilled(limit: number): Promise<UnbilledWorkOrders>;
  /** #1640: days since acceptance, not invoiced, per work order of one project (RLS-scoped view). */
  acceptanceAge(projectId: string): Promise<WorkOrderAcceptanceAge[]>;
}

/** Progress billing (#766): BoQ, assessments (operational), billing claims + evidence, the summary. */
export interface ProgressBillingRepository {
  listBoq(projectId: string): Promise<BoqItemRow[]>;
  createBoq(projectId: string, input: BoqItemInput): Promise<BoqItemRow>;
  updateBoq(id: string, input: BoqItemInput): Promise<void>;
  deleteBoq(id: string): Promise<void>;
  /** Records the month's quantities done to date; returns the derived percent. Never reaches the ERP. */
  recordAssessment(input: ProgressAssessmentInput): Promise<number>;
  listClaims(projectId: string): Promise<ProgressClaimWithInvoice[]>;
  /** Returns the new claim id. The server computes gross and recovery. */
  createClaim(input: ProgressClaimInput): Promise<string>;
  attachEvidence(claimId: string, documentId: string): Promise<void>;
  withdrawClaim(id: string): Promise<void>;
  /** Raise the claim's ERP invoice; the claim id IS the invoice's PMO record id (ADR-0077). */
  raiseInvoice(claim: { claimId: string; projectId: string; customerId: string }, intent?: CommandIntent): Promise<{ id: string; si_number: string }>;
  /** Null when the project is invisible — never a zero summary. */
  summary(projectId: string): Promise<ProjectBillingFacts | null>;
}

/**
 * Contract quantities (ADR-0091): allocations of contract lines to a work order (plain table writes) and BAST
 * acceptances (definer RPCs only). Nothing here dispatches to an ERP.
 */
export interface WorkOrderAcceptanceRepository {
  /** Every acceptance on a project with its lines, newest first; refuses a saturated list. */
  listByProject(projectId: string): Promise<WorkOrderAcceptanceWithLines[]>;
  /** The allocations of one work order. */
  listLines(workOrderId: string): Promise<WorkOrderLineRow[]>;
  /** Every allocation on a project's work orders. */
  listProjectLines(projectId: string): Promise<WorkOrderLineRow[]>;
  createLine(input: WorkOrderLineInput): Promise<WorkOrderLineRow>;
  updateLine(id: string, quantity: number): Promise<void>;
  deleteLine(id: string): Promise<void>;
  /** Creates a Draft, or replaces the Draft named by `acceptanceId`; returns the acceptance id. */
  prepare(input: PrepareWorkOrderAcceptanceInput): Promise<string>;
  withdraw(id: string): Promise<void>;
  /** Confirms; a final one closes the work order. Figures come only from this response. */
  confirm(id: string): Promise<ConfirmWorkOrderAcceptanceResult>;
}
