export type { Role } from './AuthContext';
import type { Role } from './AuthContext';
import { ALL_ROLES, MASTER_DATA_ROLES, REVENUE_WRITE_ROLES } from './coarseRoles';
import { ON_HAND_STATUSES } from '@/src/lib/db/projectTransitions';

/**
 * FE authorization primitive (ADR-0016).
 *
 * `can(action, entity, ctx)` is a PURE predicate over the real JWT role + a small
 * context. It encodes the RBAC matrix and the locked owner/Director decisions from
 * `docs/design/rbac-visibility.md` §K and `docs/plans/2026-06-07-crud-rbac-program.md`.
 *
 * IMPORTANT: this is a *clarity* projection, NEVER the security boundary. RLS and the
 * security-definer RPCs are the enforcement authority. The FE may be STRICTER than RLS
 * by design (e.g. Finance is excluded from project create/edit though RLS permits).
 *
 * The gate always reads the REAL JWT role (`ctx.realRole`), never the impersonated
 * `effectiveRole` (ADR-0008 view-as) — so an impersonating Admin sees exactly the
 * affordances the server will honor under their real role.
 *
 * Deny-by-default: a null role, a missing ctx, or an unmapped (action, entity) → false.
 */

export type Action =
  | 'view'
  | 'act'
  | 'create'
  | 'edit'
  | 'archive'
  | 'delete'
  | 'transition'
  | 'editContractValue'
  | 'setVatFlag'
  | 'setValue'
  | 'submit_sales_invoice'
  | 'record_received_date'
  | 'download_pdf'
  | 'record_efaktur'
  | 'assign_project'
  | 'pair_invoices'
  | 'manage_external_bindings'
  | 'view_financial_directory'
  | 'manage'
  | 'viewPeople'
  | 'push_timesheet'
  | 'confirm_employee_link'
  | 'upload'
  | 'withdraw'
  | 'cancel'
  | 'post'
  | 'confirm'
  | 'resolve'
  | 'prepare'
  | 'request'
  | 'decide'
  | 'revise'
  | 'link'
  | 'void'
  | 'approve'
  | 'bill'
  | 'set_readiness'
  | 'set_plan'
  | 'generate'
  | 'adjust'
  | 'advance'
  | 'raise_purchase'
  | 'waive'
  | 'cancel'
  | 'report'
  | 'close'
  | 'configure'
  | 'set'
  | 'send'
  | 'recordReservation'
  | 'recordRelease'
  | 'recordPickup'
  | 'return'
  | 'attribute'
  | 'toggleRole'
  | 'setPaymentChannel';

export type Entity =
  | 'project'
  | 'company'
  | 'procurement'
  | 'procItem'
  | 'quotation'
  | 'procDoc'
  | 'procFile'
  | 'task'
  | 'taskStatus'
  | 'incident'
  | 'incidentClose'
  | 'document'
  | 'documentStatus'
  | 'budgetLine'
  | 'budgetVersion'
  | 'user'
  | 'timesheet'
  | 'approval'
  | 'milestone'
  | 'workOrder'
  | 'thirdPartyInspection'
  | 'boqItem'
  | 'rateCatalogue'
  | 'dailySiteReport'
  | 'dailySiteReportRevenue'
  | 'safetyDay'
  | 'safetyLists'
  | 'quantityChange'
  | 'progressClaim'
  | 'billingStage'
  | 'closeoutItem'
  | 'closeoutChecklist'
  | 'workOrderLine'
  | 'workOrderAcceptance'
  | 'expenseClaim'
  | 'imprestFloat'
  | 'imprestPlan'
  | 'imprestReplenishment'
  | 'contact'
  | 'contactActivity'
  | 'meeting'
  | 'userView'
  | 'salesInvoice'
  | 'procurementInvoice'
  | 'erpPurchaseLink'
  | 'vendorWithholdingSlip'
  | 'incomingPayment'
  | 'externalBinding'
  | 'integration'
  | 'orgAccounting'
  | 'orgFeedback'
  | 'orgEmailNotifications'
  | 'costAttribution'
  | 'workOrderPlan'
  | 'workOrderSection'
  | 'workOrderPerformance'
  | 'orgPerformanceIndices'
  | 'sharedCostSplit'
  | 'labourCost'
  | 'vendorTaxDefault'
  | 'supplyRisk'
  | 'orgProjectNumbering'
  | 'orgProjectClassification'
  | 'siteReportLists'
  | 'workOrderRevenuePlan'
  | 'revenuePlanSettings'
  | 'siteCheckpoint'
  | 'siteCheckpointList'
  | 'workOrderCandidate'
  | 'workOrderCandidateTemplate'
  | 'costDiscipline'
  | 'workOrderList'
  | 'billMatch'
  | 'threeWayMatchSettings'
  | 'employeeLink'
  | 'pushHold'
  | 'odooHeldCommand'
  | 'managementPack'
  | 'projectProgress'
  | 'fxRate'
  | 'financialStatements'
  | 'journal'
  | 'projectProfitLoss'
  | 'odooLedgerHealth'
  | 'odooLedgerLines'
  | 'odooLedgerBasis'
  | 'finance'
  | 'stockItem'
  | 'stockUnit'
  | 'warehouse'
  | 'stockDocument'
  | 'materialRequest'
  | 'clientRequisition'
  | 'approvalChain'
  | 'purchaseType'
  | 'equipmentPlan'
  | 'standIn'
  | 'approvalStepPin'
  | 'materialAllowance'
  | 'usageStandard'
  | 'consumablePlan'
  | 'reorderLevel'
  | 'subcontractLines'
  | 'subcontractAcceptance'
  | 'subcontractCertificate'
  | 'subcontractRate'
  | 'poVariation'
  | 'equipmentAsset'
  | 'equipmentUsage'
  | 'equipmentCosting'
  | 'equipmentAvailability'
  | 'equipmentRegister'
  | 'expiryDocument'
  | 'documentCategory'
  | 'documentType'
  | 'person'
  | 'clearanceItem'
  | 'personClearance'
  | 'maintenance'
  | 'tmRate'
  | 'tmClaim'
  | 'tmSignoff'
  | 'crew'
  | 'attendance'
  | 'crewTool'
  | 'attendanceRate'
  | 'attendanceTarget'
  | 'leaveRequest'
  | 'checkInSettings'
  | 'imprestLimit'
  | 'equipmentTarget'
  | 'workOrderIssueThreshold'
  | 'stockReservation';

export interface PolicyContext {
  /** The REAL JWT role (not the impersonated effectiveRole). */
  realRole: Role | null;
  /** The current user's id — for record-scoped checks (own task, requester, author). */
  currentUserId?: string | null;
  /** The record under consideration — for status/ownership-conditional rules. */
  record?: {
    /** Feature-local view-as fence for evidence writes; callers compare effective and real roles. */
    viewOnly?: boolean;
    /** Which master kind a connector surface acts on (ECA2-T17): Finance may accept
     *  account matches only; every other integration manage affordance is Admin-only. */
    kind?: string;
    status?: string | null;
    assignee_id?: string | null;
    /** Project task write ownership and saved-view owner for record-scoped checks. */
    externallyOwned?: boolean;
    user_id?: string | null;
    /** The crew's field controller — timed checkpoints (#2594): the controller records their own crew's checkpoints. */
    field_controller_id?: string | null;
    /** Author id — for equipment usage visibility and the document-edit author rule (A-7). */
    author_id?: string | null;
    /** #2584 progress certificate: who prepared and who submitted it (the approver is neither). */
    prepared_by?: string | null;
    submitted_by?: string | null;
    /** Work-order section foreman (#2576) — the only non-structure caller who may set a section's readiness. */
    foreman_id?: string | null;
    /** Task creator — DD-TASK-8. Trigger-stamped server-side (`0204`), never client-set, so it is
     *  safe to read as an edit right here. Distinct from `assignee_id`: a task you created and
     *  assigned to someone else is still yours to edit. */
    created_by?: string | null;
    /** Meeting author — OD-MTG-1/#526. Trigger-stamped + pinned server-side (`0205`), never
     *  client-set, so it is safe to read as the meeting-edit right here. */
    created_by_id?: string | null;
    /** EVERY user who has built this record's body — the sales-invoice SoD oracle (migration 0113's
     *  append-only `sales_invoice_authors` set). The `author_id` scalar is last-writer-wins and so is
     *  only a legacy member of this set, never the whole truth. */
    author_ids?: string[] | null;
    /** Every user who has ever edited this budget version's lines; activation is forbidden to the full editor set. */
    editor_ids?: string[] | null;
    /** The sheet's approver (`timesheets.approved_by`) — the P3b `push_timesheet` oracle
     *  (FR-TSP-011): the sheet's OWN approver may always push it, regardless of role. */
    approved_by?: string | null;
    /** The project's manager (`projects.project_manager_id`) — #1519 equipment approval / allowance write scope. */
    project_manager_id?: string | null;
    [k: string]: unknown;
  };
}

// ── Role sets (named to mirror the matrix; the single source of truth) ───────
const ADMIN: Role[] = ['Admin'];
const ALL: Role[] = [...ALL_ROLES];
const DELIVERY: Role[] = ['Admin', 'Executive', 'Project Manager']; // delivery write roles
const MASTER_DATA: Role[] = [...MASTER_DATA_ROLES]; // incl. Finance
const ARCHIVE_ROLES: Role[] = ['Admin', 'Executive'];
const MONEY_AUTHORITY: Role[] = ['Admin', 'Executive', 'Finance']; // contract_value-on-won SoD
const CONFIRM_BAST: Role[] = ['Admin', 'Finance']; // BAST confirmation / any-draft withdrawal (DD-CQ-8)
const TASK_CONTRIBUTOR: Role[] = ['Finance', 'Engineer']; // task: own-created edit + own-assigned status (0355)
const MILESTONE_WRITE: Role[] = ['Admin', 'Project Manager']; // OD-DEL-7: PM+Admin only
/**
 * Revenue WRITE set — who may raise a sales invoice, record an incoming receipt, cancel either, or
 * approve (submit) an invoice (owner ruling, 2026-07-20). Exec and PM keep the revenue surface
 * VIEW-ONLY.
 *
 * The ruling is ENFORCED SERVER-SIDE, and this constant only mirrors it (round-6 re-audit, finding 3):
 * `supabase/functions/adapter-dispatch/authGuard.ts` (`moneyWriteRolesForDomain('revenue')`) and
 * migration 0114's `submit_sales_invoice` / `claim_sales_invoice_author` gates carry the SAME two
 * roles. Before that, the backend admitted Exec/PM and a PM could POST a sales-invoice cancel straight
 * to the edge function with no revenue affordance anywhere in their UI. The FE may be STRICTER than
 * the backend; it must never be the ONLY place a ruling lives. PROCUREMENT's ruling is different
 * (Admin·Exec·PM·Finance) — do not fold the two together.
 */
const REVENUE_WRITE: Role[] = [...REVENUE_WRITE_ROLES];
/** #876 slice 2 (DD-VWH-11): who may set a vendor's default tax treatment — mirrors set_vendor_tax_defaults (0273). */
const TAX_SETUP: Role[] = ['Admin', 'Finance'];
/** #2583: who may set a supplier's supply-risk status — mirrors set_vendor_supply_status (1067: Admin, Finance). */
const SUPPLY_RISK_SET: Role[] = ['Admin', 'Finance'];
/** #1515: establish a float, propose its amount (0422). */
const IMPREST_SETUP: Role[] = ['Admin', 'Finance'];
/** #1271: who may save / end / preview cost attribution rules — mirrors the 0376 RPC gate. */
const COST_ATTRIBUTION_WRITE: Role[] = ['Admin', 'Finance'];
// #2519: work-order money — plan figures and margin read by the roles that read project margin (0997/0999).
const WORK_ORDER_MONEY: Role[] = ['Admin', 'Executive', 'Finance', 'Project Manager'];
/** #1519: who may approve equipment usage — mirrors equipment_can_approve (PM only on projects they manage). */
const EQUIPMENT_APPROVE: Role[] = ['Admin', 'Executive', 'Finance', 'Project Manager'];
/** #1519: who may set what an hour is worth — mirrors save/end/preview_equipment_costing (Admin, Finance). */
const EQUIPMENT_COSTING_WRITE: Role[] = ['Admin', 'Finance'];
/** #1511 F5: who may change the Odoo-backed register — mirrors D7 (the asset rule; dispatch narrows per command). */
/** #2526: set daily status + attach proof (the field role and managers) — mirrors equipment_can_set_status (0985). */
const EQUIPMENT_STATUS_WRITE: Role[] = ['Admin', 'Project Manager', 'Engineer'];
/** #2526: rental terms and the invoice check are money — mirrors equipment_can_edit_terms / equipment_rental_check. */
const EQUIPMENT_RENTAL_MONEY: Role[] = ['Admin', 'Finance'];
const EQUIPMENT_REGISTER_WRITE: Role[] = ['Admin', 'Project Manager'];
/** #1514: who may set the CLIENT contract rate and assign people to it — mirrors save/end_contract_rate_line
 *  and set/end_contract_rate_assignee (0515: Admin, Finance). Cost and revenue are separate settings, never shared. */
const TM_RATE_WRITE: Role[] = ['Admin', 'Finance'];
/** #1514: who may confirm a client sign-off — mirrors confirm_tm_signoff (0517: Admin, Finance, never the preparer). */
const TM_CONFIRM: Role[] = ['Admin', 'Finance'];
// #1522 daily site report (1005): enter = dsr_may_enter, validate = dsr_may_validate, revenue = dsr_may_see_revenue.
const DSR_ENTER: Role[] = ['Admin', 'Engineer'];
const DSR_VALIDATE: Role[] = ['Admin', 'Finance'];
const DSR_REVENUE: Role[] = ['Admin', 'Finance', 'Executive'];

// #2578 quantity change requests (1127/1128, OD-QCR-2): author roles raise, edit and record; approver roles approve, never
// the author, an editor or the submitter (the SoD below mirrors qcr_assert_approver); the limit is Admin-only (FR-QCR-021).
const QCR_AUTHOR: Role[] = ['Admin', 'Executive', 'Project Manager', 'Finance'];
const QCR_APPROVER: Role[] = ['Admin', 'Executive', 'Finance'];

const has = (set: Role[], role: Role | null): boolean => role != null && set.includes(role);

/** WON / on-hand statuses for the contract_value SoD (ADR-0019). A value on any of
 *  these is past the pre-win boundary and edits require money authority (Exec/Finance).
 *  The membership list is the single shared `ON_HAND_STATUSES` (projectTransitions.ts) —
 *  deduped so the SoD boundary and the lifecycle group never drift apart. */
const ON_HAND_SET = new Set<string>(ON_HAND_STATUSES);

/**
 * The policy table. Each entry is `entity -> action -> predicate`. A predicate returns
 * true when the role (+ optional record/identity context) is permitted. Anything not
 * present in the table is denied by default.
 */
type Predicate = (role: Role | null, ctx: PolicyContext) => boolean;

const allow = (set: Role[]): Predicate => (role) => has(set, role);
/** Like `allow`, but a view-as (impersonation) session is view-only. */
const expiryDocumentWrite: Predicate = (role, ctx) => {
  const kind = ctx.record?.kind;
  if (ctx.record?.viewOnly === true) return false;
  return role === 'Admin' ? kind === 'person' || kind === 'equipment' : role === 'Project Manager' && kind === 'equipment';
};
const allowUnlessViewOnly = (set: Role[]): Predicate => (role, ctx) => has(set, role) && ctx.record?.viewOnly !== true;

/** Stock master data (#1512, 0412): mirrors the RLS - rank >= 20 writes, Admin deletes. UX only; RLS is the authority. */
const isOwnProjectPm: Predicate = (role, ctx) =>
  role === 'Project Manager' && !!ctx.currentUserId && ctx.record?.project_manager_id === ctx.currentUserId;
const stockMaster = () => ({
  view: allow(ALL),
  create: allowUnlessViewOnly(MASTER_DATA),
  edit: allowUnlessViewOnly(MASTER_DATA),
  archive: allowUnlessViewOnly(MASTER_DATA),
  delete: allowUnlessViewOnly(ADMIN),
});

const clientRequisitionAuthor: Predicate = (role, ctx) =>
  has(ALL, role) && ctx.record?.viewOnly !== true &&
  (role === 'Admin' || (!!ctx.currentUserId && ctx.record?.created_by === ctx.currentUserId));

const allowanceWriter: Predicate = (role, ctx) =>
  ctx.record?.viewOnly !== true &&
  (has(MONEY_AUTHORITY, role) || (role === 'Project Manager' && !!ctx.currentUserId && ctx.record?.project_manager_id === ctx.currentUserId));

const meetingAuthorOrAdmin: Predicate = (role, ctx) => {
  if (role === 'Admin') return true;
  if (!has(ALL, role)) return false;
  return !!ctx.currentUserId && ctx.record?.created_by_id === ctx.currentUserId;
};

const POLICY: Partial<Record<Entity, Partial<Record<Action, Predicate>>>> = {
  project: {
    // Every role may view the active Projects index/detail (rbac-visibility §B).
    view: allow(ALL),
    create: allow(DELIVERY),
    edit: allow(DELIVERY),
    archive: allow(ARCHIVE_ROLES),
    delete: allow(ADMIN),
    transition: allow([...MASTER_DATA]), // Admin·Exec·PM·Finance (shipped WRITE_ROLES)
    // contract_value SoD: pre-win = delivery roles; on a won/on-hand project = money authority.
    editContractValue: (role, ctx) => {
      const status = ctx.record?.status ?? '';
      return ON_HAND_SET.has(status) ? has(MONEY_AUTHORITY, role) : has(DELIVERY, role);
    },
    // OD-TAX-4: whether the project is subject to VAT — Finance/Admin only (set_project_contract_value enforces it).
    setVatFlag: allow(REVENUE_WRITE),
  },
  /**
   * Work orders (#566) — the client's inbound PO drawing down against a project's ceiling.
   *
   * Each entry MIRRORS what migrations 0193/0197 actually enforce; none of it is invented:
   *   view       ← `work_orders_select` is org + active membership only, with no role clause, so
   *                every role reads them. The Engineer's read is genuine, not an oversight.
   *   create     ← `work_orders_insert`'s role list, verbatim.
   *   edit       ← `work_orders_update`'s role list, NARROWED to Draft. The narrowing is real:
   *                `assert_work_order_update` freezes the whole body once the row leaves Draft
   *                (DD-WO-5), so offering an Edit on an Issued row would promise a write the
   *                server refuses with 42501.
   *   setValue   ← `set_work_order_value`'s `holds_pipeline_value_authority` gate (rank ≥ Project
   *                Manager = Admin·Executive·Finance·PM, Engineer excluded), narrowed to Draft by
   *                the same freeze.
   *   transition ← `transition_work_order`'s coarse role gate, verbatim.
   *
   * ⚑ WHAT THIS TABLE DELIBERATELY DOES NOT MODEL: the issue SoD. Whether *this* person may issue
   * *this* work order depends on who set its value, whether they are still active, and whether
   * they outrank the issuer — three facts a pure role predicate cannot hold. The RPC decides, and
   * its refusal messages name the remedy. Guessing here would either hide a legitimate Issue or
   * promise a refused one; both are worse than letting the server answer. There is no `delete`
   * because there is no DELETE grant and no DELETE policy — Cancel IS the soft-delete.
   */
  workOrder: {
    view: allow(ALL),
    create: allow(MASTER_DATA),
    edit: (role, ctx) => has(MASTER_DATA, role) && ctx.record?.status === 'Draft',
    setValue: (role, ctx) => has(MASTER_DATA, role) && ctx.record?.status === 'Draft',
    transition: allow(MASTER_DATA),
  },
  /**
   * Third-party inspections (#2580, migrations 1130-1134). UX ONLY: tpi_create / tpi_record_* / tpi_raise_purchase / tpi_waive /
   * tpi_cancel and the guard_tpi_transition trigger are the authority (ADR-0016); this mirrors them.
   *   view           every role reads (RLS: org + active member). Money is separate: tpi_costs nulls amounts outside
   *                  Admin/Executive/Finance/Project Manager, so the screen is not the fence.
   *   create/advance Admin, Project Manager, Finance, Engineer (the Engineer's scope is org-wide, OD-TPI-7).
   *   raise_purchase Admin, Project Manager, Finance — never the Engineer (a purchase is procurement's money path).
   *   waive          the same managers, and never the creator (TPI_WAIVE_SELF, OD-TPI-3); only where a gate exists to release.
   *   cancel         tracked-only inspections only (TPI_CANCEL_REQUIRED, OD-TPI-8): managers any time, the creator
   *                  (Engineer) only while `requested`.
   */
  thirdPartyInspection: {
    view: allow(ALL),
    create: allow(['Admin', 'Project Manager', 'Finance', 'Engineer']),
    advance: (role, ctx) => has(['Admin', 'Project Manager', 'Finance', 'Engineer'], role)
      && ctx.record?.status !== 'cancelled' && ctx.record?.status !== 'reported',
    raise_purchase: (role, ctx) => has(['Admin', 'Project Manager', 'Finance'], role) && ctx.record?.status === 'requested',
    waive: (role, ctx) => {
      const gates = ctx.record?.required_for;
      return has(['Admin', 'Project Manager', 'Finance'], role)
        && Array.isArray(gates) && gates.length > 0
        && ctx.record?.status !== 'cancelled' && !ctx.record?.waived_at
        && !(ctx.currentUserId && ctx.record?.created_by === ctx.currentUserId);
    },
    cancel: (role, ctx) => {
      const gates = ctx.record?.required_for;
      if (!Array.isArray(gates) || gates.length > 0) return false;
      const status = ctx.record?.status;
      if (status === 'cancelled' || status === 'reported') return false;
      if (has(['Admin', 'Project Manager', 'Finance'], role)) return true;
      return role === 'Engineer' && status === 'requested' && Boolean(ctx.currentUserId) && ctx.record?.created_by === ctx.currentUserId;
    },
  },
  /** Bill of quantities (#766) — mirrors 0250's boq_items policies: the work-order writer set. */
  rateCatalogue: { view: allow(MASTER_DATA), create: allowUnlessViewOnly(REVENUE_WRITE) },
  /**
   * Daily site report (#1522, 1005). UX ONLY — dsr_save_draft/dsr_submit/dsr_validate/dsr_return/dsr_correct and
   * dsr_report_revenue are the authority (ADR-0016). Until #902 adds the field-controller and QS roles, the field role
   * is Engineer and the QS is Finance. A PM acts only on a project they manage (`record.project_manager_id`).
   *   create  ← enter and submit;  approve ← validate or return, never the author (SoD, ADR-0019);
   *   revise  ← start a correction of a validated report;  dailySiteReportRevenue.view ← rates and revenue.
   */
  dailySiteReport: {
    view: allow(ALL),
    create: (role, ctx) => ctx.record?.viewOnly !== true && (has(DSR_ENTER, role) || isOwnProjectPm(role, ctx)),
    approve: (role, ctx) =>
      ctx.record?.viewOnly !== true && !!ctx.currentUserId && ctx.record?.author_id !== ctx.currentUserId &&
      (has(DSR_VALIDATE, role) || isOwnProjectPm(role, ctx)),
    revise: (role, ctx) => ctx.record?.viewOnly !== true && (has(DSR_VALIDATE, role) || isOwnProjectPm(role, ctx)),
  },
  dailySiteReportRevenue: { view: (role, ctx) => has(DSR_REVENUE, role) || isOwnProjectPm(role, ctx) },
  /**
   * Daily safety records (#2596, 1410-1414). UX ONLY. Mirrors safety_may_enter: Admin, Engineer, or the project's own PM
   * enter, submit and correct; every active member reads counts; worker names and photos follow OD-DSF-6
   * (`viewPeople`). The database refuses everything else.
   */
  safetyDay: {
    view: allow(ALL),
    create: (role, ctx) => ctx.record?.viewOnly !== true && (has(DSR_ENTER, role) || isOwnProjectPm(role, ctx)),
    edit: (role, ctx) => ctx.record?.viewOnly !== true && (has(DSR_ENTER, role) || isOwnProjectPm(role, ctx)),
    viewPeople: (role, ctx) => has(['Admin', 'Executive', 'Engineer'], role) || isOwnProjectPm(role, ctx),
  },
  /** The check types, permit types and pre-work checklist: Admin-only rows (1410) and the switch (set_safety_records_enabled). */
  safetyLists: { manage: allow(ADMIN) },
  /**
   * Quantity change requests (#2578). UX only: qcr_* functions and RLS are the authority (ADR-0016/0019).
   *   view ← read;  create ← raise or edit a draft;  act ← submit (the author or an editor);
   *   approve ← approve or return, never the author, ANY editor (`record.editor_ids`) or the submitter (`record.submitted_by`);
   *   withdraw ← author, editor or an approver role;  decide ← record the client send and decision;
   *   request ← record a forecast quantity (the project's own PM, or Finance and above, mirrors may_record_project_progress);
   *   manage ← set the organisation's request limit.
   */
  quantityChange: {
    view: allow(QCR_AUTHOR),
    create: allowUnlessViewOnly(QCR_AUTHOR),
    act: (role, ctx) =>
      ctx.record?.viewOnly !== true && has(QCR_AUTHOR, role) && !!ctx.currentUserId &&
      (ctx.record?.author_id === ctx.currentUserId || (ctx.record?.editor_ids ?? []).includes(ctx.currentUserId)),
    approve: (role, ctx) =>
      ctx.record?.viewOnly !== true && has(QCR_APPROVER, role) && !!ctx.currentUserId &&
      ctx.record?.author_id !== ctx.currentUserId && ctx.record?.submitted_by !== ctx.currentUserId &&
      !(ctx.record?.editor_ids ?? []).includes(ctx.currentUserId),
    withdraw: (role, ctx) =>
      ctx.record?.viewOnly !== true && has(QCR_AUTHOR, role) && !!ctx.currentUserId &&
      (has(QCR_APPROVER, role) || ctx.record?.author_id === ctx.currentUserId || (ctx.record?.editor_ids ?? []).includes(ctx.currentUserId)),
    decide: allowUnlessViewOnly(QCR_AUTHOR),
    request: (role, ctx) => ctx.record?.viewOnly !== true && (has(QCR_APPROVER, role) || isOwnProjectPm(role, ctx)),
    manage: allowUnlessViewOnly(ADMIN),
  },
  boqItem: {
    view: allow(MASTER_DATA),
    create: allow(MASTER_DATA),
    edit: allow(MASTER_DATA),
    delete: allow(MASTER_DATA),
  },
  stockItem: stockMaster(),
  stockUnit: stockMaster(),
  /** `manage` = assign warehouse keepers (set_stock_warehouse_keeper is Admin only). */
  warehouse: { ...stockMaster(), manage: allowUnlessViewOnly(ADMIN) },
  /** Material allowances (#1512 S5, PQ-7): mirrors `may_record_project_progress` - Finance rank and above on any project,
   *  a PM only where `record.project_manager_id` is them. UX only; RLS is the authority. */
  materialAllowance: {
    view: allow(ALL),
    create: (role, ctx) => allowanceWriter(role, ctx),
    edit: (role, ctx) => allowanceWriter(role, ctx),
    delete: (role, ctx) => allowanceWriter(role, ctx),
  },
  /** Consumable usage standards (#2577, 1075): mirrors `stock_master_writer()` - rank >= 20 (PM, Finance, Executive, Admin) writes;
   *  archive, never delete (ADR-0018). UX only; RLS is the authority. */
  usageStandard: { view: allow(ALL), create: allowUnlessViewOnly(MASTER_DATA), edit: allowUnlessViewOnly(MASTER_DATA), archive: allowUnlessViewOnly(MASTER_DATA) },
  /** Work-order consumable plan (#2577, 1076): generate and adjust follow the allowance write rule (`may_record_project_progress`):
   *  Admin, Executive, Finance on any project, a PM only on their own. Pass the work order's PROJECT row as `ctx.record`
   *  (a work order has no `project_manager_id`). UX only; the RPCs are the authority. */
  consumablePlan: { view: allow(ALL), generate: allowanceWriter, adjust: allowanceWriter },
  /** Reorder levels (#1512 S6, PQ-6): everyone reads; rank >= 20 sets, edits or clears. UX only; the RPC is the authority. */
  reorderLevel: { view: allow(ALL), edit: allowUnlessViewOnly(MASTER_DATA) },
  /** Stock documents (#1512 S3): mirrors FR-STK-061/062. `isKeeper` is supplied by the screen from the keeper list. UX only; RLS/RPC is the authority. */
  stockDocument: {
    view: allow(ALL),
    create: (role, ctx) => ctx.record?.viewOnly !== true && (ctx.record?.isKeeper === true || role === 'Admin'),
    post: (role, ctx) =>
      ctx.record?.viewOnly !== true &&
      (ctx.record?.kind === 'adjustment' || ctx.record?.kind === 'count'
        ? has(MASTER_DATA, role) && !!ctx.currentUserId && ctx.record?.created_by !== ctx.currentUserId // FR-STK-062
        : ctx.record?.isKeeper === true || role === 'Admin'),
    withdraw: (role, ctx) =>
      ctx.record?.viewOnly !== true && ctx.record?.status === 'Draft' && (role === 'Admin' || (!!ctx.currentUserId && ctx.record?.created_by === ctx.currentUserId)),
  },
  /**
   * Material requests (#2524, migrations 1000/1001). Every member raises one (FR-MRQ-016: the field role is a job, not a
   * system role); only the author edits/submits a draft or withdraws while undecided. `decide` is offered only for a
   * step in the caller's "waiting for me" queue (`inMyQueue`, which already applies role, stand-in window and
   * one-step-per-person) and never to the author. UX only: mrq_decide_step is the authority.
   */
  materialRequest: {
    view: allow(ALL),
    create: allowUnlessViewOnly(ALL),
    edit: (role, ctx) =>
      has(ALL, role) && ctx.record?.viewOnly !== true && ctx.record?.status === 'draft' &&
      !!ctx.currentUserId && ctx.record?.created_by === ctx.currentUserId,
    withdraw: (role, ctx) =>
      has(ALL, role) && ctx.record?.viewOnly !== true && (ctx.record?.status === 'draft' || ctx.record?.status === 'pending') &&
      !!ctx.currentUserId && ctx.record?.created_by === ctx.currentUserId,
    decide: (role, ctx) =>
      has(ALL, role) && ctx.record?.viewOnly !== true && ctx.record?.inMyQueue === true &&
      !!ctx.currentUserId && ctx.record?.created_by !== ctx.currentUserId,
  },
  /**
   * Client material requisitions (#2585, migrations 1086/1087; spec docs/specs/client-material-requisitions.spec.md).
   * Mirrors the csr_* RPCs: every member raises one; the author (or an Admin) edits, sends and cancels it (cancel not once
   * a pickup is posted, `record.hasPickup`); Project Manager and above record the client's reservation or release on an
   * open requisition; the keeper of the receiving location (`record.isKeeper`, supplied by the screen) or an Admin records
   * a pickup. View-as sessions are view-only. UX only: the RPCs are the authority.
   */
  clientRequisition: {
    view: allow(ALL),
    create: allowUnlessViewOnly(ALL),
    edit: (role, ctx) => clientRequisitionAuthor(role, ctx) && ctx.record?.status === 'draft',
    send: (role, ctx) => clientRequisitionAuthor(role, ctx) && ctx.record?.status === 'draft',
    cancel: (role, ctx) =>
      clientRequisitionAuthor(role, ctx) && (ctx.record?.status === 'draft' || ctx.record?.status === 'open') && ctx.record?.hasPickup !== true,
    recordReservation: (role, ctx) => has(MASTER_DATA, role) && ctx.record?.viewOnly !== true && ctx.record?.status === 'open',
    recordRelease: (role, ctx) => has(MASTER_DATA, role) && ctx.record?.viewOnly !== true && ctx.record?.status === 'open',
    recordPickup: (role, ctx) =>
      has(ALL, role) && ctx.record?.viewOnly !== true && ctx.record?.status === 'open' && (ctx.record?.isKeeper === true || role === 'Admin'),
  },
  /** The org's approval chain and daily cut-off (FR-MRQ-005/014): Admin only, mirroring mrq_set_chain / mrq_set_cutoff. */
  approvalChain: { view: allow(ALL), manage: allowUnlessViewOnly(ADMIN) },
  /** The org's purchase types and the switch that turns them on (#2697): Admin only, mirroring set_purchase_types_enabled / upsert_purchase_type. */
  purchaseType: { view: allow(ALL), manage: allowUnlessViewOnly(ADMIN) },
  /** The monthly equipment and service plan (#2700). UX only: the RPCs enforce the same roles and the approver route (the database also checks who approves and refuses the author). `manage` = the settings and categories, Admin only. */
  equipmentPlan: { view: allow(ALL), create: allowUnlessViewOnly(ALL), manage: allowUnlessViewOnly(ADMIN) },
  /** Stand-ins (FR-MRQ-009): the person away names their own; an Admin names anyone's (mrq_set_stand_in). */
  standIn: {
    view: allow(ALL),
    manage: (role, ctx) =>
      has(ALL, role) && ctx.record?.viewOnly !== true &&
      (role === 'Admin' || (!!ctx.currentUserId && ctx.record?.delegator_id === ctx.currentUserId)),
  },
  /** Pinning an approval step to a named person on a project (#2598, mrq_set_step_pin): an Admin or the project's own manager. */
  approvalStepPin: {
    view: allow(ALL),
    manage: (role, ctx) =>
      has(ALL, role) && ctx.record?.viewOnly !== true &&
      (role === 'Admin' || (!!ctx.currentUserId && ctx.record?.project_manager_id === ctx.currentUserId)),
  },
  /**
   * Work-order allocations of contract lines (ADR-0091, migration 0337). Mirrors the allocation table's RLS:
   * the BoQ writer set, and only while the work order is Draft/Issued (the state trigger freezes Closed/Cancelled).
   * `record.status` is the WORK ORDER's status; unknown status denies. View-as sessions are view-only.
   */
  workOrderLine: {
    view: allow(MASTER_DATA),
    create: (role, ctx) => has(MASTER_DATA, role) && isOpenWorkOrder(ctx) && ctx.record?.viewOnly !== true,
    edit: (role, ctx) => has(MASTER_DATA, role) && isOpenWorkOrder(ctx) && ctx.record?.viewOnly !== true,
    delete: (role, ctx) => has(MASTER_DATA, role) && isOpenWorkOrder(ctx) && ctx.record?.viewOnly !== true,
  },
  /**
   * BAST acceptances (ADR-0091). UX only — the three definer RPCs are the authority.
   *   create   (prepare)  ← `may_record_project_progress`: Finance rank and above, or the project's own PM
   *                         (`record.project_manager_id`), on an Issued work order (`record.status`).
   *   confirm             ← Admin/Finance on a Draft acceptance (`record.status`). The preparer IS offered it, with a
   *                         hint: the server refuses same-person confirmation unless they are the organisation's sole
   *                         operator (a one-person org must be able to close a work order); the refusal is shown.
   *   withdraw            ← the preparer, or Admin/Finance, on a Draft acceptance.
   */
  workOrderAcceptance: {
    view: allow(MASTER_DATA),
    create: (role, ctx) =>
      ctx.record?.viewOnly !== true && ctx.record?.status === 'Issued' &&
      (has(MONEY_AUTHORITY, role) ||
        (role === 'Project Manager' && !!ctx.currentUserId && ctx.record?.project_manager_id === ctx.currentUserId)),
    confirm: (role, ctx) =>
      ctx.record?.viewOnly !== true && ctx.record?.status === 'Draft' && has(CONFIRM_BAST, role),
    withdraw: (role, ctx) =>
      ctx.record?.viewOnly !== true && ctx.record?.status === 'Draft' &&
      (has(CONFIRM_BAST, role) || (!!ctx.currentUserId && ctx.record?.prepared_by === ctx.currentUserId)),
  },
  /**
   * Billing claims (#766). view = the revenue read set; create (raise included) and transition (evidence,
   * withdraw) = REVENUE_WRITE, mirroring the claim RPCs and the dispatch's revenue money-write roles.
   * Assessing progress is #765's `projectProgress.edit`, unchanged. The server is the authority.
   */
  progressClaim: {
    view: allow(MASTER_DATA),
    create: allow(REVENUE_WRITE),
    transition: allow(REVENUE_WRITE),
  },
  /**
   * Billing stages and retention (#2522, #1572; 0960/0961). transition = record a stage and attach its documents
   * (lock_billing_stage_claim: Admin, Finance, Project Manager); edit = the stage list, the invoice deadline, retention
   * and its releases (Finance/Admin). The database is the authority.
   */
  billingStage: {
    view: allow(MASTER_DATA),
    transition: allow(['Admin', 'Finance', 'Project Manager']),
    edit: allow(CONFIRM_BAST),
  },
  /**
   * Work-order close-out checklist (#2593; 1400–1402). transition = attach a document to an item and mark it done
   * (lock_closeout_item: Admin, Finance, and the project's own manager); edit = the organisation's list (Admin). The close
   * itself stays with transition_work_order's roles; the database guard refuses it while a required item is open. UX only.
   */
  closeoutItem: { view: allow(ALL), transition: allow(['Admin', 'Finance', 'Project Manager']) },
  closeoutChecklist: { view: allow(ALL), edit: allow(ADMIN) },
  /**
   * Expense claims and cash advances (#775, migration 0247). Mirrors the server:
   *   view/create ← every active member raises their own (RLS insert: claimant = auth.uid()); reads are RLS-scoped
   *                 to own ∪ approval rank, so the page is safe for every role.
   *   edit        ← the claimant only, while Draft/Rejected (RLS update policy + the 0247 §2 freeze).
   * Status moves are NOT modelled here — who may approve/pay/cancel/return depends on identity, route and SoD;
   * `availableExpenseActions` (src/lib/expenses/expenseRules.ts) projects that and the RPC decides.
   */
  expenseClaim: {
    view: allow(ALL),
    create: allow(ALL),
    edit: (role, ctx) =>
      has(ALL, role) &&
      !!ctx.currentUserId &&
      ctx.record?.claimant_id === ctx.currentUserId &&
      (ctx.record?.status === 'Draft' || ctx.record?.status === 'Rejected'),
    attribute: (role, ctx) =>
      ctx.record?.viewOnly !== true &&
      (has(['Admin', 'Executive', 'Finance', 'Project Manager'], role) ||
        (has(ALL, role) &&
          !!ctx.currentUserId &&
          ctx.record?.claimant_id === ctx.currentUserId &&
          (ctx.record?.status === 'Draft' || ctx.record?.status === 'Rejected'))),
  },
  /**
   * Site imprest (#1515, 0422-0424). Floats, plans and replenishments are visible to approval rank (RLS). Status moves
   * and pay depend on identity (custodian, author, requester) and are projected by src/lib/imprest/imprestRules.ts.
   */
  // MASTER_DATA = Admin, Executive, Project Manager, Finance = approval rank (holds_spend_approval_authority)
  imprestFloat: { view: allow(MASTER_DATA), create: allow(IMPREST_SETUP), edit: allow(IMPREST_SETUP) },
  imprestPlan: { view: allow(MASTER_DATA), create: allow(MASTER_DATA) },
  imprestReplenishment: { view: allow(MASTER_DATA) },
  company: {
    // Companies directory view = Admin·Exec·PM·Finance (rbac-visibility §D); Engineer = ○ (no
    // nav, no page). Drives the page-level Companies gate (A-5).
    view: allow(MASTER_DATA),
    create: allow(MASTER_DATA),
    edit: allow(MASTER_DATA),
    archive: allow(ARCHIVE_ROLES),
    delete: allow(ADMIN),
  },
  finance: { view: allow(MONEY_AUTHORITY), act: allow(REVENUE_WRITE) },
  financialStatements: { view: allow(MONEY_AUTHORITY) },
  /**
   * #895 manual journals (owner ruling 2). The desk is Finance-or-above; `approve` (and Return) is for a
   * Finance-or-above member who did not write the journal: not its maker, not any editor
   * (`record.author_ids`) and, for a reversal, nobody who wrote the original (`record.original_author_ids`).
   * Exception: the member of an org that has only ever had one member (one profile, any status) may approve their own
   * journal (`record.sole_active_member` carries the server's `may_approve_journal` answer). Deny without a record or a user id. UX only; the RPC is the authority.
   */
  journal: {
    view: allow(MONEY_AUTHORITY),
    create: allow(MONEY_AUTHORITY),
    edit: allow(MONEY_AUTHORITY),
    approve: (role, ctx) => {
      const record = ctx.record;
      const me = ctx.currentUserId;
      if (!has(MONEY_AUTHORITY, role) || !record || record.viewOnly === true || !me) return false;
      if (record.sole_active_member === true) return true;
      const wrote = (ids: unknown): boolean => Array.isArray(ids) && ids.includes(me);
      return record.maker_id !== me && !wrote(record.author_ids) && !wrote(record.original_author_ids);
    },
  },
  projectProfitLoss: { view: allow(ALL) },
  // Odoo ledger (#1507 S7, FR-ODA-061/062). UX only; the RPCs and RLS decide. Health, reconciliation and the switch controls are
  // for Admin and Finance; source lines are for Admin, Finance and Executive (a Project Manager or Engineer reads totals only).
  // The switch itself, and the "explained difference" confirmation within it, are Admin only and fenced while viewing as another role.
  odooLedgerHealth: { view: allow(['Admin', 'Finance']) },
  odooLedgerLines: { view: allow(MONEY_AUTHORITY) },
  odooLedgerBasis: { act: allowUnlessViewOnly(ADMIN), confirm: allowUnlessViewOnly(ADMIN) },
  procurement: {
    // Index visibility (rbac-visibility §A/§E): Admin·Exec·PM·Finance browse the org-wide
    // PR index; Engineer has NO Procurement nav (○*) and reaches only their OWN requests
    // (RLS-scoped). This `view` gate drives the ⌘K module-row guard (A-8) so an Engineer's
    // palette never surfaces org-wide procurement rows. The Engineer's own-scoped /procurement
    // page (A-3) is reachable regardless — it gates the org-wide affordances, not the route.
    view: allow([...MASTER_DATA]),
    create: allow(ALL), // ANY member incl. Engineer (requester server-stamped)
    edit: allow(ALL), // record-scoped (requester while Draft/Rejected) at the call-site
    transition: allow([...MASTER_DATA]), // FE shows; SoD identity + RPC are the authority
    setPaymentChannel: (role, ctx) =>
      ctx.record?.viewOnly !== true &&
      (((ctx.record?.status === 'Draft' || ctx.record?.status === 'Rejected') &&
        (role === 'Admin' || (!!ctx.currentUserId && ctx.record?.requested_by_id === ctx.currentUserId))) ||
       (has(['Finance', 'Admin'], role) && ctx.record?.status !== 'Paid' && ctx.record?.status !== 'Cancelled')),
    // no archive / no hard delete — Cancel only (handled as a transition)
  },
  procItem: {
    create: allow(MASTER_DATA),
    edit: allow(MASTER_DATA),
    delete: allow(MASTER_DATA),
  },
  quotation: {
    create: allow(['Admin', 'Project Manager', 'Finance']),
    edit: allow(['Admin', 'Project Manager', 'Finance']),
  },
  procDoc: {
    create: allow(MASTER_DATA),
    edit: allow(MASTER_DATA),
  },
  procFile: {
    // Procurement phase-file attachments (quotation/GR/VI). Writer set = the procurement
    // master-data roles (Admin·Exec·PM·Finance), mirroring procDoc. UX-only — the
    // procurement-files RLS (migration 0028) is the enforcement authority.
    create: allow(MASTER_DATA),
    edit: allow(MASTER_DATA),
    delete: allow(MASTER_DATA),
  },
  task: {
    // DD-TASK-8 (#551, migration 0204): an Engineer may create tasks. The old exclusion had no
    // ruling behind it — it traced to the 0002 bootstrap role list and was copied forward by four
    // migrations, while OD-MTG-1 ruled every role may minute a meeting whose /action creates a task.
    // Owner ruling 2026-10-23 (migration 0355): Finance is scoped exactly like an Engineer on tasks —
    // create, edit what it created, set status on what it is assigned; no edit-all, archive or delete.
    create: allow(ALL),
    // Record-scoped: a delivery role, or the creator when tasks are locally owned.
    // ⚑ NOT the assignee — the 3-lens review removed the assignee disjunct from `tasks_update` (it
    // was redundant with `tasks_update_own_status` and its only net effect was bypassing the ClickUp
    // guard), so offering the assignee a full Edit form here would promise a write the server
    // refuses. The assignee's real affordance is the status control (`taskStatus.edit`, below).
    // `can()` is UX only — RLS is the authority (ADR-0016) — and looser-than-RLS is the one
    // direction that is never allowed.
    edit: (role, ctx) => {
      if (has(DELIVERY, role)) return true;
      if (!ctx.currentUserId) return false;
      return ctx.record?.externallyOwned !== true && ctx.record?.created_by === ctx.currentUserId;
    },
    archive: allow(DELIVERY), // 0355: Finance lost the write-role path (archived_at is a lifecycle column)
    delete: allow(DELIVERY),
    // #2587 FR-RLT-004: set or clear the record link. A delivery role on any task; anyone else only on a task they
    // CREATED (the link is a work field on the creator allow-list); never the assignee, never an externally-owned task.
    // Same shape as `edit` — the database (check_task_record_link + the column pin) is the authority.
    link: (role, ctx) => {
      if (has(DELIVERY, role)) return true;
      if (!ctx.currentUserId) return false;
      return ctx.record?.externallyOwned !== true && ctx.record?.created_by === ctx.currentUserId;
    },
  },
  taskStatus: {
    // Managers may set any task's status; an Engineer or Finance member may set status only on
    // their OWN (assigned) task — RLS tasks_update_own_status (0355 scopes Finance like Engineer).
    edit: (role, ctx) => {
      if (has(DELIVERY, role)) return true;
      if (has(TASK_CONTRIBUTOR, role)) {
        const owns = !!ctx.currentUserId && ctx.record?.assignee_id === ctx.currentUserId;
        return owns;
      }
      return false;
    },
  },
  incident: {
    create: allow(ALL), // ANY member files (reporter server-stamped)
    edit: allow(DELIVERY), // managers investigate
    delete: allow(ADMIN),
  },
  incidentClose: {
    transition: allow(DELIVERY), // only managers close
  },
  document: {
    create: allow(MASTER_DATA),
    // Edit a document = ◆ AUTHOR (rbac-visibility §H): a master-data write-role who AUTHORED it,
    // OR Admin (break-glass — edit is not an SoD axis, reading-rule 4). A non-author manager
    // does NOT get Edit. Record-scoped (mirrors taskStatus): pass `{ currentUserId, record:
    // { author_id } }` at the call-site. Deny-by-default authorship: with no record context only
    // Admin passes (a non-Admin must prove authorship). RLS/RPC stays the authority.
    edit: (role, ctx) => {
      if (!has(MASTER_DATA, role)) return false;
      if (role === 'Admin') return true;
      return !!ctx.currentUserId && ctx.record?.author_id === ctx.currentUserId;
    },
    delete: allow(ADMIN),
  },
  documentStatus: {
    transition: allow(MASTER_DATA), // approver ≠ author enforced at the call-site + RPC
  },
  budgetLine: {
    create: allow(MASTER_DATA),
    edit: allow(MASTER_DATA), // Draft-only checked at the call-site (shipped WRITE_ROLES)
    delete: allow(MASTER_DATA),
  },
  /**
   * Budget version activation (`transition`) — OD-BUDGET-6/DD-BUDGET-7, mirroring `activate_budget_version`
   * (migration 0280): a Draft only; no recorded editor (including the drafter) may activate their
   * version, whatever their role, Admin included; a version with no recorded drafter is Admin or
   * Finance only. The RPC is the authority.
   */
  budgetVersion: {
    transition: (role, ctx) => {
      if (!has(['Admin', 'Executive', 'Finance'], role) || ctx.record?.status !== 'Draft') return false;
      const drafter = ctx.record?.created_by ?? null;
      if (ctx.currentUserId && (ctx.record?.editor_ids ?? []).includes(ctx.currentUserId)) return false;
      if (drafter === null) return role === 'Admin' || role === 'Finance';
      return !!ctx.currentUserId && drafter !== ctx.currentUserId;
    },
  },
  user: {
    // Exec may VIEW a read-only user directory (rbac-visibility §J); write is Admin-only.
    view: allow(ARCHIVE_ROLES), // Admin·Executive
    create: allow(ADMIN),
    edit: allow(ADMIN),
    archive: allow(ADMIN),
    delete: allow(ADMIN),
  },
  timesheet: {
    create: allow(['Admin', 'Executive', 'Project Manager', 'Engineer']),
    edit: allow(['Admin', 'Executive', 'Project Manager', 'Engineer']),
    /**
     * P3b (FR-TSP-011) — the Retry/push affordance for a flipped org's ERP push. UX ONLY: the
     * enforcement authorities are `approved_timesheet_for_push` (migration 0138) and
     * `approvalGuard.ts`'s `enforceTimesheetApproved` — the FE may be STRICTER than the DB, never
     * looser. The rule is deliberately NOT `MONEY_WRITE_ROLES`/`MASTER_DATA` alone: a legitimate
     * approver is very often an Engineer-role line manager (`profiles.manager_id`), so the sheet's
     * OWN `approved_by` always passes regardless of role — narrowing this to a money-role set would
     * break the primary approval path (the exact P3a-pattern-matching trap the plan calls out).
     */
    push_timesheet: (role, ctx) => {
      if (has(MASTER_DATA, role)) return true; // Admin·Executive·Project Manager·Finance
      return !!ctx.currentUserId && ctx.record?.approved_by === ctx.currentUserId;
    },
  },
  approval: {
    transition: allow(DELIVERY), // approve others' timesheets; !self enforced at the call-site + RPC
  },
  milestone: {
    // All org members may view milestones (FR-DEL-018); writes are PM+Admin only (FR-DEL-019, OD-DEL-7).
    view: allow(ALL),
    create: allow(MILESTONE_WRITE),
    edit: allow(MILESTONE_WRITE),
    delete: allow(MILESTONE_WRITE),
  },
  contact: {
    // CRM is master data — a directory of people, mirroring `company` (rbac-visibility §D):
    // view/create/edit = the 4 master-data writers (Engineer = ○, no CRM nav/page); archive =
    // Admin·Exec; hard-delete = Admin only. UX-only — the contacts RLS (0030) is the authority.
    view: allow(MASTER_DATA),
    create: allow(MASTER_DATA),
    edit: allow(MASTER_DATA),
    archive: allow(ARCHIVE_ROLES),
    delete: allow(ADMIN),
  },
  contactActivity: {
    // Logging/editing/deleting a touchpoint is a routine master-data write (no SoD axis) —
    // any of the 4 master-data writers. RLS (crm_activities_write for ALL) is the authority.
    view: allow(MASTER_DATA),
    create: allow(MASTER_DATA),
    edit: allow(MASTER_DATA),
    delete: allow(MASTER_DATA),
  },
  meeting: {
    // #526 (OD-MTG-1, migrations 0205/0206): meetings are NOT master data — writing minutes is
    // ordinary RBAC for EVERY role, Engineer included (the widening is meetings-only; contacts
    // and crm_activities are untouched). READING a meeting body is attendance ∪ author ∪ grant ∪
    // Admin — enforced by RLS row-scoping, so `view` here only says "the route/page exists for
    // you"; an Engineer who attends meetings needs the page. RLS is the authority (ADR-0016).
    view: allow(ALL),
    create: allow(ALL),
    // Record-scoped, mirroring `meetings_update` (0205 §3) exactly: the AUTHOR or Admin. Grants
    // are VIEW-ONLY (OD-MTG-2) — a grantee or attendee reads, they never rewrite — so offering a
    // non-author an Edit affordance would promise a write the server refuses. Deny-by-default
    // authorship: with no record context only Admin passes.
    edit: meetingAuthorOrAdmin,
    // OD-MTG-3: soft archive mirrors the author-or-Admin meetings_update authority in RLS.
    archive: meetingAuthorOrAdmin,
    delete: allow(ADMIN),
  },
  userView: {
    // Any authenticated user may create views; owners and Admin may edit or archive.
    // RLS is the real authority (user_views_insert/update/delete, I1).
    create: allow(ALL),
    edit: (role, ctx) => has(ALL, role) && (role === 'Admin' || (!!ctx.currentUserId && ctx.record?.user_id === ctx.currentUserId)),
    archive: (role, ctx) => has(ALL, role) && (role === 'Admin' || (!!ctx.currentUserId && ctx.record?.user_id === ctx.currentUserId)),
  },
  // Revenue domain — SI submit SoD (OD-SAR-PMO-IS-THE-UI, FR-SAR-195)
  // UX-only: author cannot submit their own draft; different approver-role user can.
  // RLS/RPC is the enforcement authority (submit_sales_invoice RPC).
  fxRate: {
    view: allow(REVENUE_WRITE),
    upload: (role, ctx) => has(REVENUE_WRITE, role) && ctx.record?.viewOnly !== true,
    create: (role, ctx) => has(ADMIN, role) && ctx.record?.viewOnly !== true,
    edit: (role, ctx) => has(ADMIN, role) && ctx.record?.viewOnly !== true,
  },
  salesInvoice: {
    // Sales Invoices index — Finance, PM, Exec can view (rbac-visibility §D mirror).
    view: allow(MASTER_DATA),
    // Raise an invoice = Finance + Admin (owner ruling 2026-07-20). Without this entry the
    // "New Invoice" affordance rendered for NO role and the whole P3a create path was unreachable.
    create: allow(REVENUE_WRITE),
    // Cancel (docstatus 1→2) is modelled as a `transition` — the same write set as create.
    // NOTE: no `edit` entry on purpose — the page has no update mutation (the row-menu Edit is a
    // no-op stub), so granting `edit` would surface an affordance that does nothing.
    transition: allow(REVENUE_WRITE),
    // #767: record the date the client received the invoice — any non-cancelled state. Mirrors the
    // `set_sales_invoice_received_date` RPC's Admin+Finance gate (the RPC is the authority).
    record_received_date: allow(REVENUE_WRITE),
    // #912 (DD-PDF-1/2): download the ERP's own PDF of a SUBMITTED, ERP-owned invoice — the client
    // document. Mirrors external-invoice-pdf, which re-checks role, active membership and the LIVE ERP
    // docstatus; this is UX only.
    download_pdf: (role, ctx) =>
      has(REVENUE_WRITE, role)
      && ctx.record?.erp_docstatus === 1
      && ['Submitted', 'Unpaid', 'Paid'].includes(String(ctx.record?.status ?? '')),
    // DD-EFK-1: e-Faktur facts stay PMO-owned and are editable by the revenue write set only.
    record_efaktur: allow(REVENUE_WRITE),
    // PMO project attribution remains separate from the ERP invoice body and is role-gated server-side.
    assign_project: allow(REVENUE_WRITE),
    // ECA-5: accept PMO↔ERP invoice pairs (accept_invoice_pairs re-asserts Admin/Finance; this is UX only).
    pair_invoices: allow(REVENUE_WRITE),
    // Approve/submit an invoice = the revenue write set (Admin + Finance). Migration 0114 gates the
    // `submit_sales_invoice` RPC on exactly these roles, so offering Exec/PM the affordance would
    // render a button that 403s.
    submit_sales_invoice: (role, ctx) => {
      if (!has(REVENUE_WRITE, role)) return false;
      if (!ctx.currentUserId) return false;
      const authorIds = ctx.record?.author_ids ?? null;
      const authorScalar = ctx.record?.author_id ?? null;
      // Fail CLOSED on an unattributable invoice — mirrors the RPC's `sod-author-missing`: an invoice
      // nobody is recorded as having authored is exactly one with no two-person control.
      if (authorScalar == null && (authorIds == null || authorIds.length === 0)) return false;
      // NOBODY WHO EVER WROTE THE BODY MAY APPROVE (0113): the oracle is the append-only author SET,
      // union the legacy scalar. Comparing the scalar alone was last-writer-wins — an earlier writer
      // whom a co-worker's edit displaced saw an ENABLED Submit that 403'd on click.
      if (authorScalar === ctx.currentUserId) return false;
      if (authorIds?.includes(ctx.currentUserId)) return false;
      return true;
    },
  },
  procurementInvoice: {
    // Vendor bills and their payments: every role except Engineer (owner ruling 2026-10-23, migration 0350);
    // server RLS remains authoritative.
    view: allow(MASTER_DATA),
    // DD-EFK-1: vendor e-Faktur facts use the same Admin/Finance UX gate as outgoing invoices.
    record_efaktur: allow(REVENUE_WRITE),
    // #1671: voiding a mistyped PMO-native subcontract bill is a post-capture bill write, Admin/Finance like the
    // line attribution and e-Faktur. UX only — void_subcontract_bill (0885) enforces role, author SoD and the ERP boundary.
    void: allow(REVENUE_WRITE),
    // Recording a supplier bill from the payables list: Admin or Finance, never while viewing as another role. UX only — the bill RPCs decide.
    create: allowUnlessViewOnly(REVENUE_WRITE),
  },
  erpPurchaseLink: {
    // ADR-0093: linking an ERPNext purchase document into a purchase (FR-PFE-020) — the ERP-purchase audience; an
    // Engineer reads no ERP purchase documents (0350). Unlink (FR-PFE-031) is Admin/Finance. UX only — the
    // link/unlink RPCs are the enforcement authority.
    create: allow(MASTER_DATA),
    delete: allow(REVENUE_WRITE),
  },
  vendorWithholdingSlip: {
    // Every role except Engineer, who reads no payment records (owner ruling 2026-10-23, migration 0350);
    // server RLS remains authoritative.
    view: allow(MASTER_DATA),
    create: (role, ctx) => has(REVENUE_WRITE, role) && ctx.record?.viewOnly !== true,
    edit: (role, ctx) => has(REVENUE_WRITE, role) && ctx.record?.viewOnly !== true,
    archive: (role, ctx) => has(REVENUE_WRITE, role) && ctx.record?.viewOnly !== true,
  },
  incomingPayment: {
    // Incoming Payments index — mirrors the salesInvoice view set (Admin·Exec·PM·Finance);
    // Engineer has no revenue nav/page. Missing entirely before this entry, which made
    // /incoming-payments render "You don't have access" for EVERY role incl. Admin.
    view: allow(MASTER_DATA),
    // Record a receipt = Finance + Admin (owner ruling 2026-07-20).
    create: allow(REVENUE_WRITE),
    // Cancel (docstatus 1→2). No `edit` — the page has no update mutation.
    transition: allow(REVENUE_WRITE),
  },
  // External bindings management — Admin only
  externalBinding: {
    manage_external_bindings: allow(ADMIN),
  },
  integration: {
    // Admin self-serve connect/disconnect (UX gate). Server (edge fn + RPC) re-enforces
    // Admin OR platform Operator. FE is stricter (Admin only; Finance for accounts, ECA2-T17).
    manage: (role, ctx) => {
      if (has(ADMIN, role)) return true;
      if (role === 'Finance' && ctx?.record?.kind === 'account') return true;
      return false;
    },
    // Odoo (#1504 S5, AC-ODC-082). UX ONLY: the edge-function routers + RPCs are the authority. The `viewOnly` fence is
    // the view-as case (effective role differs from the real one): an impersonating Admin sees no write control.
    manage_external_bindings: (role, ctx) => has(ADMIN, role) && ctx.record?.viewOnly !== true,
    setValue: (role, ctx) => has(TAX_SETUP, role) && ctx.record?.viewOnly !== true,
    // The Odoo financial directory (accounts, taxes): Admin, Executive, Finance. Named for what it gates; `view` on integration is not defined.
    view_financial_directory: allow(MONEY_AUTHORITY),
  },
  // OD-TAX-1 (#548): org-wide ACCOUNTING configuration — currently the tax-treatment default that
  // pre-selects every new money form. Admin-only, mirroring migration 0207's RLS policy exactly
  // (`auth_role() = 'Admin'` + active membership) rather than approximating it: flipping an org's
  // tax posture is an accounting judgement, the same class as the budget→ERP account map (0137).
  // UX ONLY — RLS is the enforcement authority (ADR-0016), and the FE may be stricter, never looser.
  orgProjectClassification: { manage: allow(ADMIN) },
  // #2595: candidate work orders. Open and assess: Admin, Engineer, or the project's own Project Manager (mirrors create_work_order_candidate and
  // the item policies of 1405); decide: Admin or the project's Project Manager (decide_work_order_candidate, 1407). The checklist template is Admin-only
  // (set_work_order_candidate_template). Pass the project's manager id as ctx.record.project_manager_id. UX ONLY; the database decides.
  workOrderCandidate: {
    view: allow(ALL),
    create: (role, ctx) => has(['Admin', 'Engineer'], role) || isOwnProjectPm(role, ctx),
    edit: (role, ctx) => has(['Admin', 'Engineer'], role) || isOwnProjectPm(role, ctx),
    approve: (role, ctx) => role === 'Admin' || isOwnProjectPm(role, ctx),
  },
  workOrderCandidateTemplate: { manage: allow(ADMIN) },
  // #2621: the site report idle-reason and weather lists. Mirrors the Admin-only insert/update policies of 1040. UX ONLY.
  siteReportLists: { manage: allow(ADMIN) },
  // #2671 dated revenue plan per work order. UX ONLY — wo_revenue_plan_* (1276) and the reads (1277) are the authority
  // (ADR-0016): the project's own Project Manager only, Admin/Executive/Finance on any project.
  workOrderRevenuePlan: { view: allow(['Admin', 'Executive', 'Finance', 'Project Manager']), manage: allow(['Admin', 'Executive', 'Finance', 'Project Manager']) },
  revenuePlanSettings: { manage: allow(ADMIN) },
  /**
   * Timed checkpoints (#2594, 1385..1388). UX ONLY — record_site_checkpoint and the read rule are the authority (ADR-0016).
   *   view   ← Admin, Executive, Engineer, the work order's project manager, the crew's own field controller;
   *   create ← record: Admin, Engineer, the work order's project manager, the crew's own field controller (not Executive).
   */
  siteCheckpoint: {
    view: (role, ctx) => has(['Admin', 'Executive', 'Engineer'], role) || isOwnProjectPm(role, ctx)
      || (!!ctx.currentUserId && ctx.record?.field_controller_id === ctx.currentUserId),
    create: (role, ctx) => ctx.record?.viewOnly !== true && (has(['Admin', 'Engineer'], role) || isOwnProjectPm(role, ctx)
      || (!!ctx.currentUserId && ctx.record?.field_controller_id === ctx.currentUserId)),
  },
  siteCheckpointList: { manage: allow(ADMIN) },
  // #2623 (FR-WCA-011): the organisation's cost disciplines. Mirrors 0950's RLS (insert/update/delete: active Admin). UX ONLY.
  costDiscipline: { create: allow(ADMIN), edit: allow(ADMIN), archive: allow(ADMIN) },
  // #2668 (FR-WAG-002): the organisation's work-order area and group lists. Mirrors 1382's RLS (Admin writes). UX ONLY.
  workOrderList: { create: allow(ADMIN), edit: allow(ADMIN), archive: allow(ADMIN) },
  // #2622 (1018): a bill's three-way match. get_bill_match reads for Admin/Executive/PM/Finance; approve_bill_match_exception
  // is Admin/Finance, never the bill's author nor its lines' recorder (SoD in the RPC). UX ONLY.
  billMatch: { view: allow(WORK_ORDER_MONEY), approve: allow(['Admin', 'Finance']), edit: allow(WORK_ORDER_MONEY) },
  // #2634 (1018 §8 / 1357): the organisation's match on/off and tolerances. set_three_way_match_settings is Admin only. UX ONLY.
  // `billMatch.edit` is the receipt-line and bill-line editors (record_receipt_match_lines / record_bill_match_lines).
  threeWayMatchSettings: { manage: allow(ADMIN) },
  orgAccounting: {
    manage: allow(ADMIN),
  },
  // #2579: document categories and their viewer roles. Mirrors the management functions of migration 1093 (active Admin). UX ONLY — they are the authority (ADR-0016).
  documentCategory: {
    manage: allow(ADMIN),
    view: (role, ctx) =>
      role === 'Admin' ||
      (!!role && Array.isArray(ctx.record?.roles) && (ctx.record.roles as unknown[]).includes(role)),
    toggleRole: (_role, ctx) => ctx.record?.role !== 'Admin',
  },
  // #1532 S9: the org's feedback-and-surveys switch. Mirrors admin_set_feedback_surveys (0419: active Admin). UX ONLY.
  orgFeedback: { manage: allow(ADMIN) },
  // #2711: which events send email, the extra roles copied, the email language. Mirrors set_email_* (1223: active Admin). UX ONLY.
  orgEmailNotifications: { manage: allow(ADMIN) },
  // #1271: cost attribution rules — mirrors save/end/preview_cost_attribution (0376: active Admin or Finance).
  // UX ONLY — the RPCs are the authority (ADR-0016).
  costAttribution: { manage: allow(COST_ATTRIBUTION_WRITE) },
  // #2519 plan vs actual per work order. UX ONLY — work_order_plan_lines RLS (0997), set/clear_shared_cost_split (0998)
  // and work_order_cost_amounts (0999) are the authority (ADR-0016).
  workOrderPlan: { view: allow(WORK_ORDER_MONEY), manage: allow(WORK_ORDER_MONEY) },
  // #2597: cost and schedule indices. UX ONLY: get_work_order_performance refuses anyone who cannot read revenue and cost,
  // and the organisation setting is written by an Admin only (RLS on organizations).
  workOrderPerformance: { view: allow(WORK_ORDER_MONEY) },
  orgPerformanceIndices: { manage: allow(ADMIN) },
  sharedCostSplit: { manage: allow(['Admin', 'Executive', 'Finance']) },
  // #2670: labour cost rates, classes and the switch. Mirrors save_labour_cost_*/RLS of 1250 (Admin, Finance write; Executive also reads). UX ONLY.
  labourCost: { view: allow(['Admin', 'Finance', 'Executive']), manage: allow(['Admin', 'Finance']) },
  /**
   * #2576 work-order sections. UX ONLY — work_order_sections RLS + guard_work_order_section (1095) and
   * set_work_order_plan (1096) are the authority (ADR-0016).
   *   view          ← every active member (read follows work-order read).
   *   create/edit/archive/set_plan ← the roles that write plan figures (0997): WORK_ORDER_MONEY.
   *   delete        ← Admin only (RLS delete policy); the foreign keys still block a referenced section.
   *   set_readiness ← those roles, or the section's own foreman (the guard trigger limits a foreman to readiness).
   * The work order must be open for structure edits (Cancelled freezes every section; Closed allows readiness and archive).
   */
  workOrderSection: {
    view: allow(ALL),
    create: (role, ctx) => has(WORK_ORDER_MONEY, role) && ctx.record?.viewOnly !== true && !['Closed', 'Cancelled'].includes(ctx.record?.status ?? ''),
    edit: (role, ctx) => has(WORK_ORDER_MONEY, role) && ctx.record?.viewOnly !== true && !['Closed', 'Cancelled'].includes(ctx.record?.status ?? ''),
    archive: (role, ctx) => has(WORK_ORDER_MONEY, role) && ctx.record?.viewOnly !== true && ctx.record?.status !== 'Cancelled',
    delete: (role, ctx) => role === 'Admin' && ctx.record?.viewOnly !== true && ctx.record?.status !== 'Cancelled',
    set_plan: (role, ctx) => has(WORK_ORDER_MONEY, role) && ctx.record?.viewOnly !== true && ctx.record?.status !== 'Cancelled',
    set_readiness: (role, ctx) => ctx.record?.viewOnly !== true && ctx.record?.status !== 'Cancelled'
      && (has(WORK_ORDER_MONEY, role) || (!!ctx.currentUserId && ctx.record?.foreman_id === ctx.currentUserId)),
  },
  /**
   * Equipment usage and allocation (#1519, migrations 0447/0460/0471). UX ONLY — transition_equipment_usage,
   * save_equipment_costing and the reads are the authority (ADR-0016); the FE may be stricter, never looser.
   *   equipmentAsset  ← equipment_assets RLS: every active member reads (the grid's picker); Admin/PM keep it by hand.
   *   equipmentUsage  ← create = any active member (`save_equipment_usage`); transition = the author NEVER (the SoD mirror;
   *                     `author_id` is NOT NULL server-side) and a PM only on a project they manage — the mirror of
   *                     `equipment_can_approve`.
   *   equipmentCosting← Admin/Finance write; approval rank reads.
   */
  equipmentAsset: {
    view: allow(ALL),
    create: allowUnlessViewOnly(['Admin', 'Project Manager']),
    edit: allowUnlessViewOnly(['Admin', 'Project Manager']),
    delete: allowUnlessViewOnly(ADMIN),
  },
  equipmentUsage: {
    create: allowUnlessViewOnly(ALL),
    transition: (role, ctx) =>
      ctx.record?.viewOnly !== true &&
      has(EQUIPMENT_APPROVE, role) &&
      !!ctx.currentUserId &&
      ctx.record?.author_id !== ctx.currentUserId &&
      (role !== 'Project Manager' || ctx.record?.project_manager_id === ctx.currentUserId),
    view: (role, ctx) => has(EQUIPMENT_APPROVE, role) || (
      role === 'Engineer' && !!ctx.currentUserId && ctx.record?.author_id === ctx.currentUserId
    ), // Engineers may read their own entries; the audience above may read amounts and others' entries.
  },
  equipmentCosting: { manage: allowUnlessViewOnly(EQUIPMENT_COSTING_WRITE), view: allow(EQUIPMENT_APPROVE) },
  /**
   * Equipment availability, ownership and rental downtime (#2526, migrations 0985-0986). UX ONLY — the RPCs
   * (`set_equipment_status`, `save_equipment_rental_term`, `equipment_metrics`) are the authority.
   *   view   ← every active member reads status (the bulk screen); metrics need the approval audience (`equipment_metrics`).
   *   create ← set status / attach proof: Admin, PM, Engineer (the field controller). Not Finance or Executive.
   *   manage ← rental terms: Admin, Finance. A field controller never edits rates.
     */
  equipmentAvailability: {
    view: allow(ALL),
    create: allowUnlessViewOnly(EQUIPMENT_STATUS_WRITE),
    manage: allowUnlessViewOnly(EQUIPMENT_RENTAL_MONEY),
    approve: allowUnlessViewOnly(EQUIPMENT_RENTAL_MONEY),
  },
  /**
   * Crews, roster and daily attendance (#2528, migrations 0988-0990). UX ONLY — RLS, `crew_can_manage`,
   * `attendance_can_record`, `attendance_record` and `attendance_decide_week` are the authority (ADR-0016).
   *   crew        ← every active member reads the master and roster; `crew_can_manage` (Admin, Executive, PM) writes;
   *               `create` gates the import buttons (#2551) and equals `manage`.
   *   attendance  ← create = a crew manager, or the field controller of the crew (`record.field_controller_id`);
   *                 approve (a no-login week) = a crew manager who recorded none of it (`record.recorder_ids`, the SoD
   *                 mirror of 0990). A login's week is approved on the timesheet, whose own gate applies.
   */
  /**
   * Leave and sick requests (#2708, migrations 1240-1243). UX ONLY — `leave_request_submit/decide/cancel` and
   * `set_leave_settings` are the authority (ADR-0016); the FE may be stricter, never looser.
   *   request / cancel ← every member; the database narrows to the person, their line manager or an office user.
   *   decide           ← any role (the line manager can be any role); the screen also needs the database's `can_decide`
   *                      for the row, which carries line manager, approver role and the self-decide refusal (LV_SOD).
   *   manage           ← Admin: the on/off switch, the approver role and the leave type list (`set_leave_settings`).
   *   A view-as session may do none of them.
   */
  leaveRequest: {
    request: allowUnlessViewOnly(ALL),
    cancel: allowUnlessViewOnly(ALL),
    decide: allowUnlessViewOnly(ALL),
    manage: allowUnlessViewOnly(ADMIN),
  },
  crew: { view: allow(ALL), create: allowUnlessViewOnly(DELIVERY), manage: allowUnlessViewOnly(DELIVERY) },
  attendance: {
    create: (role, ctx) => ctx.record?.viewOnly !== true && (
      has(DELIVERY, role) || (!!ctx.currentUserId && ctx.record?.field_controller_id === ctx.currentUserId)),
    approve: (role, ctx) => ctx.record?.viewOnly !== true && has(DELIVERY, role) && !(
      !!ctx.currentUserId && Array.isArray(ctx.record?.recorder_ids) && (ctx.record.recorder_ids as unknown[]).includes(ctx.currentUserId)),
  },
  /**
   * Crew hand-tools register and damage/loss reports (#2581, migrations 1080-1083). UX ONLY — RLS, the column grants and the
   * `report_crew_tool` / `correct_crew_tool_report` / `close_crew_tool_report` / `set_crew_tool_settings` RPCs are the authority.
   *   view      ← every active member (the crew master's own read rule, OQ-CTR-4).
   *   manage    ← add, edit, move, archive lines, and correct a report: a crew manager (`crew_can_manage`: Admin, Executive, PM).
   *   report    ← a crew manager, or the crew's field controller (`record.field_controller_id`).
   *   close     ← a crew manager, or the report task's assignee (`record.assignee_id`); never the reporter by that fact alone.
   *   configure ← the equipment coordinator and due days: Admin and Project Manager (the equipment register write set).
   */
  crewTool: {
    view: allow(ALL),
    manage: allowUnlessViewOnly(DELIVERY),
    report: (role, ctx) => ctx.record?.viewOnly !== true && (
      has(DELIVERY, role) || (!!ctx.currentUserId && ctx.record?.field_controller_id === ctx.currentUserId)),
    close: (role, ctx) => ctx.record?.viewOnly !== true && (
      has(DELIVERY, role) || (!!ctx.currentUserId && ctx.record?.assignee_id === ctx.currentUserId)),
    configure: allowUnlessViewOnly(EQUIPMENT_REGISTER_WRITE),
  },
  /**
   * #2706 attendance rate against a target. UX ONLY — the RPC `attendance_rate_by_crew` (1437) re-asserts the active
   * membership, the caller's org and these four roles, mirroring attendance_days_select (1036): a crew-level reader
   * would see a figure built from rows they cannot read. `attendanceTarget` mirrors the Admin-only organizations
   * update policy (0207/0231) and the column grant of 1436.
   */
  attendanceRate: { view: allow(['Admin', 'Executive', 'Project Manager', 'Finance']) },
  attendanceTarget: { manage: allow(ADMIN) },

  /**
   * The Odoo fleet and maintenance register (#1511 F5). UX ONLY — the `adapter-dispatch` `equipment` domain's role
   * gates and 0797's RPC/RLS are the authority (ADR-0016); the FE may be stricter, never looser.
   *   equipmentRegister ← register writes need Admin or Project Manager (D7, the shipped asset rule).
   *   maintenance        ← every active role records maintenance (D7); both refuse a view-as session.
   */
  equipmentRegister: {
    view: allow(ALL),
    create: allowUnlessViewOnly(EQUIPMENT_REGISTER_WRITE),
    edit: allowUnlessViewOnly(EQUIPMENT_REGISTER_WRITE),
  },
  /**
   * Expiring documents on people and equipment (#2542, migration 0970 RLS). UX ONLY — RLS and the column grants are the
   * authority (ADR-0016): Admin writes any document, a Project Manager equipment documents only. `record.kind` is the subject.
   */
  expiryDocument: {
    view: allow(ALL),
    create: expiryDocumentWrite,
    edit: expiryDocumentWrite,
    archive: expiryDocumentWrite,
  },
  /** Document types and warning days (#2614). UX ONLY: document_types RLS and column grants (0970) and set_document_warning_days (0972) are Admin-only. View-as is view-only. */
  documentType: { manage: allowUnlessViewOnly(ADMIN) },
  /**
   * The People register (#2542 follow-up, migration 1008). UX ONLY — RLS (0970 people_* policies) and the column grants are the
   * authority (ADR-0016). The crews policy change grants basic reads to members and create/edit to Admin and Project Manager; archive remains Admin-only. View-as is view-only.
   */
  person: {
    view: allow(ALL),
    create: allowUnlessViewOnly(['Admin', 'Project Manager']),
    edit: allowUnlessViewOnly(['Admin', 'Project Manager']),
    archive: allowUnlessViewOnly(ADMIN),
  },
  /**
   * Cleared-for-site checklist (#2707, migrations 1235-1237). UX ONLY — RLS is the authority (ADR-0016). Admin defines the items and
   * switches the feature on; Admin and Project Manager record a person's state; Finance and Executive read. View-as is view-only.
   */
  clearanceItem: {
    view: allow(['Admin', 'Project Manager', 'Finance', 'Executive']),
    manage: allowUnlessViewOnly(ADMIN),
  },
  personClearance: {
    view: allow(['Admin', 'Project Manager', 'Finance', 'Executive']),
    edit: allowUnlessViewOnly(['Admin', 'Project Manager']),
  },
  maintenance: {
    view: allow(ALL),
    create: allowUnlessViewOnly(ALL),
    edit: allowUnlessViewOnly(ALL),
  },
  /**
   * Time-and-materials claims (#1514, migrations 0515-0517). UX ONLY — the RPCs are the authority (ADR-0016); the FE
   * may be stricter, never looser.
   *   tmRate     ← `manage` = save/end a rate line and assign a person: Admin or Finance (0515). A PM reads the rates
   *                of a project they manage but never writes them; an Executive never writes them either.
   *   tmClaim    ← `prepare` (assemble, deselect, prepare the sign-off) mirrors `may_record_project_progress` (0245):
   *                Finance rank and above on any project, or the project's own PM (`record.project_manager_id`).
   *   tmSignoff  ← `confirm` mirrors ALL of 0517 `confirm_tm_signoff`, both halves of its separation-of-duties rule:
   *                Admin or Finance (never a view-as session) AND neither SoD identity — the RPC refuses when the actor
   *                is `prepared_by` (the assembler) OR `signoff_prepared_by` (who prepared the sign-off), so the mirror
   *                reads both keys. Its ONE exception is mirrored too: an organisation with a single active member may
   *                confirm their own sign-off (basis `sole_operator`, the 0298 predicate), which the record opens with
   *                `soleActiveMember`/`sole_active_member` (T8 supplies it from the org's member list — exactly one
   *                active profile). Without the flag the refusal stands, so the mirror is the plan's stricter reading;
   *                a record carrying neither identity offers the affordance and lets the RPC's `42501` speak.
   */
  tmRate: { manage: allowUnlessViewOnly(TM_RATE_WRITE) },
  tmClaim: {
    prepare: (role, ctx) =>
      ctx.record?.viewOnly !== true &&
      (has(MONEY_AUTHORITY, role) ||
        (role === 'Project Manager' && !!ctx.currentUserId && ctx.record?.project_manager_id === ctx.currentUserId)),
  },
  tmSignoff: {
    confirm: (role, ctx) => {
      if (ctx.record?.viewOnly === true || !has(TM_CONFIRM, role) || !ctx.currentUserId) return false;
      const uid = ctx.currentUserId;
      const assembler = ctx.record?.preparedBy ?? ctx.record?.prepared_by;
      const signoffPreparer = ctx.record?.signoffPreparedBy ?? ctx.record?.signoff_prepared_by;
      if (uid !== assembler && uid !== signoffPreparer) return true;
      // The 0298 sole-active-member exception: the same person holds both identities and the RPC accepts with basis
      // `sole_operator`. Hiding it would leave a one-person organisation unable to confirm (and invoice) a claim.
      return ctx.record?.soleActiveMember === true || ctx.record?.sole_active_member === true;
    },
  },
  // #876 slice 2: a vendor's default VAT / PPh treatment. UX ONLY — set_vendor_tax_defaults is the authority.
  vendorTaxDefault: { manage: allow(TAX_SETUP) },
  // #2583: a supplier's supply-risk status. UX ONLY — set_vendor_supply_status (1067) and companies_supply_risk_guard
  // (1065) are the authority; `view` offers the panel to the Master-data roles (the flag itself is org-readable).
  supplyRisk: { view: allow(MASTER_DATA), set: allow(SUPPLY_RISK_SET) },
  orgProjectNumbering: {
    manage: allow(ADMIN),
  },
  // P3b (OQ-TSP-10(C) — the owner ruling): the Employee-adopt link is PROPOSE-then-CONFIRM, never
  // auto-confirmed. Confirming re-points which PMO user a week of ERP hours is attributed to — an
  // identity decision, Admin-only. UX ONLY: `confirm_erp_employee_link` (migrations 0111/0141) is the
  // enforcement authority.
  employeeLink: {
    confirm_employee_link: allow(ADMIN),
  },
  // ⚑ MED-2 (money-safety audit round 6): releasing a `held` ERP command re-opens the door to a MONEY
  // write — the machine refused to resolve it precisely because a human must. Admin-only, matching
  // `release_outbox_hold` (mig 0137 §4), which re-asserts org + Admin + active membership itself.
  // UX ONLY: the RPC is the enforcement authority (ADR-0016).
  pushHold: {
    manage: allow(ADMIN),
  },
  // #1505 P8 (FR-OPP-063/094): resolving a held Odoo payment is Admin or Finance, and never while viewing as another role.
  // UX ONLY: `resolve_held_outbox_command` re-checks role, org, standing and that the resolver is not the dispatcher.
  odooHeldCommand: {
    resolve: (role, ctx) => has(TAX_SETUP, role) && ctx.record?.viewOnly !== true,
  },
  // #765 (DD-MMP-4): the management pack mirrors the revenue READ set (salesInvoice.view). RLS on
  // sales_invoices admits every active member; the FE is stricter, exactly as for the invoice lists.
  managementPack: {
    view: allow(MASTER_DATA),
  },
  // #765 (DD-MMP-4): a project's month-end percent complete. Mirrors migration 0245's
  // `may_record_project_progress`: Finance rank and above on any project, or the project's own PM.
  // UX ONLY — record_project_progress + RLS are the authority (ADR-0016).
  projectProgress: {
    edit: (role, ctx) =>
      has(MONEY_AUTHORITY, role) ||
      (role === 'Project Manager' &&
        !!ctx.currentUserId &&
        ctx.record?.project_manager_id === ctx.currentUserId),
  },
  // #1513 S6: subcontract lines, acceptances, and variations. UX ONLY — RPCs and RLS are the authority.
  subcontractLines: {
    edit: allowUnlessViewOnly(['Admin', 'Finance', 'Project Manager']),
  },
  subcontractAcceptance: {
    prepare: (role, ctx) =>
      ctx.record?.viewOnly !== true &&
      (has(MONEY_AUTHORITY, role) ||
        (role === 'Project Manager' &&
          !!ctx.currentUserId &&
          ctx.record?.project_manager_id === ctx.currentUserId)),
    confirm: allowUnlessViewOnly(['Admin', 'Finance']),
  },
  // #2584 subcontractor progress certificate. UX ONLY — the database RPCs and RLS are the authority:
  // prepare (also submit, cancel and backcharges): Finance and Admin, or the project's own PM (spc_may_prepare);
  // approve (also return): Finance, Executive and Admin, never the preparer or submitter (approve_subcontract_certificate; OD-SPC-9);
  // bill: Finance and Admin; read: Admin, Executive, Finance, or the project's PM (spc_may_read).
  subcontractCertificate: {
    view: (role, ctx) =>
      has(MONEY_AUTHORITY, role) ||
      (role === 'Project Manager' && !!ctx.currentUserId && ctx.record?.project_manager_id === ctx.currentUserId),
    prepare: (role, ctx) =>
      ctx.record?.viewOnly !== true &&
      (has(['Admin', 'Finance'], role) ||
        (role === 'Project Manager' && !!ctx.currentUserId && ctx.record?.project_manager_id === ctx.currentUserId)),
    approve: (role, ctx) =>
      ctx.record?.viewOnly !== true && has(['Admin', 'Finance', 'Executive'], role) &&
      !(ctx.currentUserId && (ctx.record?.prepared_by === ctx.currentUserId || ctx.record?.submitted_by === ctx.currentUserId)),
    return: allowUnlessViewOnly(['Admin', 'Finance', 'Executive']),
    bill: allowUnlessViewOnly(['Admin', 'Finance']),
  },
  // #2705: phone check-in settings — who decides outside-area check-ins (1210: active Admin). UX ONLY.
  checkInSettings: { manage: allowUnlessViewOnly(ADMIN) },
  // The organisation's site-cash limit (`set_imprest_procurement_limit` is Admin-only). UX ONLY.
  imprestLimit: { manage: allow(ADMIN) },
  // #2701: equipment targets and working hours (1470: active Admin). UX ONLY.
  equipmentTarget: { manage: allowUnlessViewOnly(ADMIN) },
  // #2584: work order issue threshold (1340: active Admin). UX ONLY.
  workOrderIssueThreshold: { manage: allowUnlessViewOnly(ADMIN) },
  // #2584 / #2689: stock reservations (1440: location keeper or master-data roles). UX ONLY.
  stockReservation: {
    manage: (role, ctx) =>
      ctx.record?.viewOnly !== true &&
      (ctx.record?.isKeeper === true || has(MASTER_DATA, role)),
  },
  // The subcontractor rate card is cost data (FR-SPC-003): Admin and Finance write, Executive reads.
  subcontractRate: {
    manage: allowUnlessViewOnly(['Admin', 'Finance']),
    view: (role) => has(['Admin', 'Executive', 'Finance', 'Project Manager'], role),
  },
  poVariation: {
    request: (role, ctx) =>
      ctx.record?.viewOnly !== true &&
      (has(MASTER_DATA, role) ||
        (has(ALL, role) && !!ctx.currentUserId && ctx.record?.requested_by_id === ctx.currentUserId)),
    decide: allowUnlessViewOnly(['Admin', 'Finance', 'Executive', 'Project Manager']),
    revise: allowUnlessViewOnly(['Admin', 'Finance', 'Project Manager']),
    link: allowUnlessViewOnly(['Admin', 'Finance', 'Project Manager']),
  },
};

/** Allocation writes are open only while the work order is Draft or Issued (`record.status` = the work order's). */
function isOpenWorkOrder(ctx: PolicyContext): boolean {
  return ctx.record?.status === 'Draft' || ctx.record?.status === 'Issued';
}

/**
 * The pure policy predicate. Reads the REAL role from `ctx.realRole`. Deny-by-default.
 */
export function can(action: Action, entity: Entity, ctx?: PolicyContext): boolean {
  if (!ctx || ctx.realRole == null) return false;
  const predicate = POLICY[entity]?.[action];
  if (!predicate) return false;
  return predicate(ctx.realRole, ctx);
}
