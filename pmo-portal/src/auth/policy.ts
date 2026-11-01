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
  | 'push_timesheet'
  | 'confirm_employee_link'
  | 'upload'
  | 'withdraw'
  | 'post'
  | 'confirm';

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
  | 'boqItem'
  | 'progressClaim'
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
  | 'costAttribution'
  | 'vendorTaxDefault'
  | 'orgProjectNumbering'
  | 'orgProjectClassification'
  | 'employeeLink'
  | 'pushHold'
  | 'managementPack'
  | 'projectProgress'
  | 'fxRate'
  | 'financialStatements'
  | 'projectProfitLoss'
  | 'finance'
  | 'stockItem'
  | 'stockUnit'
  | 'warehouse'
  | 'stockDocument'
  | 'materialAllowance'
  | 'reorderLevel';

export interface PolicyContext {
  /** The REAL JWT role (not the impersonated effectiveRole). */
  realRole: Role | null;
  /** The current user's id — for record-scoped checks (own task, requester, author). */
  currentUserId?: string | null;
  /** The record under consideration — for status/ownership-conditional rules. */
  record?: {
    /** Feature-local view-as fence for evidence writes; callers compare effective and real roles. */
    viewOnly?: boolean;
    status?: string | null;
    assignee_id?: string | null;
    /** Project task write ownership and saved-view owner for record-scoped checks. */
    externallyOwned?: boolean;
    user_id?: string | null;
    /** Author id — for the document-edit author rule (A-7). */
    author_id?: string | null;
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
/** #1515: establish a float, propose its amount (0422). */
const IMPREST_SETUP: Role[] = ['Admin', 'Finance'];
/** #1271: who may save / end / preview cost attribution rules — mirrors the 0376 RPC gate. */
const COST_ATTRIBUTION_WRITE: Role[] = ['Admin', 'Finance'];

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
const allowUnlessViewOnly = (set: Role[]): Predicate => (role, ctx) => has(set, role) && ctx.record?.viewOnly !== true;

/** Stock master data (#1512, 0412): mirrors the RLS - rank >= 20 writes, Admin deletes. UX only; RLS is the authority. */
const stockMaster = () => ({
  view: allow(ALL),
  create: allowUnlessViewOnly(MASTER_DATA),
  edit: allowUnlessViewOnly(MASTER_DATA),
  archive: allowUnlessViewOnly(MASTER_DATA),
  delete: allowUnlessViewOnly(ADMIN),
});

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
  /** Bill of quantities (#766) — mirrors 0250's boq_items policies: the work-order writer set. */
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
  projectProfitLoss: { view: allow(ALL) },
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
    // Admin OR platform Operator. FE is stricter (Admin only).
    manage: allow(ADMIN),   // no view-as fence: it predates the fence, and the ERPNext/ClickUp cards share it
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
  orgAccounting: {
    manage: allow(ADMIN),
  },
  // #1532 S9: the org's feedback-and-surveys switch. Mirrors admin_set_feedback_surveys (0419: active Admin). UX ONLY.
  orgFeedback: { manage: allow(ADMIN) },
  // #1271: cost attribution rules — mirrors save/end/preview_cost_attribution (0376: active Admin or Finance).
  // UX ONLY — the RPCs are the authority (ADR-0016).
  costAttribution: { manage: allow(COST_ATTRIBUTION_WRITE) },
  // #876 slice 2: a vendor's default VAT / PPh treatment. UX ONLY — set_vendor_tax_defaults is the authority.
  vendorTaxDefault: { manage: allow(TAX_SETUP) },
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
