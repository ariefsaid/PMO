import type { Role } from './AuthContext';
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
  | 'create'
  | 'edit'
  | 'archive'
  | 'delete'
  | 'transition'
  | 'editContractValue'
  | 'submit_sales_invoice'
  | 'manage_external_bindings'
  | 'manage'
  | 'push_timesheet'
  | 'confirm_employee_link';

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
  | 'user'
  | 'timesheet'
  | 'approval'
  | 'milestone'
  | 'contact'
  | 'contactActivity'
  | 'userView'
  | 'salesInvoice'
  | 'incomingPayment'
  | 'externalBinding'
  | 'integration'
  | 'employeeLink'
  | 'pushHold';

export interface PolicyContext {
  /** The REAL JWT role (not the impersonated effectiveRole). */
  realRole: Role | null;
  /** The current user's id — for record-scoped checks (own task, requester, author). */
  currentUserId?: string | null;
  /** The record under consideration — for status/ownership-conditional rules. */
  record?: {
    status?: string | null;
    assignee_id?: string | null;
    /** Author id — for the document-edit author rule (A-7). */
    author_id?: string | null;
    /** EVERY user who has built this record's body — the sales-invoice SoD oracle (migration 0113's
     *  append-only `sales_invoice_authors` set). The `author_id` scalar is last-writer-wins and so is
     *  only a legacy member of this set, never the whole truth. */
    author_ids?: string[] | null;
    /** The sheet's approver (`timesheets.approved_by`) — the P3b `push_timesheet` oracle
     *  (FR-TSP-011): the sheet's OWN approver may always push it, regardless of role. */
    approved_by?: string | null;
    [k: string]: unknown;
  };
}

// ── Role sets (named to mirror the matrix; the single source of truth) ───────
const ADMIN: Role[] = ['Admin'];
const ALL: Role[] = ['Admin', 'Executive', 'Project Manager', 'Finance', 'Engineer'];
const DELIVERY: Role[] = ['Admin', 'Executive', 'Project Manager']; // delivery write roles
const MASTER_DATA: Role[] = ['Admin', 'Executive', 'Project Manager', 'Finance']; // incl. Finance
const ARCHIVE_ROLES: Role[] = ['Admin', 'Executive'];
const MONEY_AUTHORITY: Role[] = ['Admin', 'Executive', 'Finance']; // contract_value-on-won SoD
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
const REVENUE_WRITE: Role[] = ['Admin', 'Finance'];

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
  },
  company: {
    // Companies directory view = Admin·Exec·PM·Finance (rbac-visibility §D); Engineer = ○ (no
    // nav, no page). Drives the page-level Companies gate (A-5).
    view: allow(MASTER_DATA),
    create: allow(MASTER_DATA),
    edit: allow(MASTER_DATA),
    archive: allow(ARCHIVE_ROLES),
    delete: allow(ADMIN),
  },
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
    create: allow(DELIVERY),
    edit: allow(DELIVERY),
    archive: allow(DELIVERY),
    delete: allow(DELIVERY),
  },
  taskStatus: {
    // Managers may set any task's status; an Engineer may set status only on their OWN task.
    edit: (role, ctx) => {
      if (has(DELIVERY, role)) return true;
      if (role === 'Engineer') {
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
  userView: {
    // Any authenticated user may create, edit, and archive their OWN views.
    // RLS is the real authority (user_views_insert/update/delete, I1).
    create: allow(ALL),
    edit: allow(ALL),
    archive: allow(ALL),
  },
  // Revenue domain — SI submit SoD (OD-SAR-PMO-IS-THE-UI, FR-SAR-195)
  // UX-only: author cannot submit their own draft; different approver-role user can.
  // RLS/RPC is the enforcement authority (submit_sales_invoice RPC).
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
};

/**
 * The pure policy predicate. Reads the REAL role from `ctx.realRole`. Deny-by-default.
 */
export function can(action: Action, entity: Entity, ctx?: PolicyContext): boolean {
  if (!ctx || ctx.realRole == null) return false;
  const predicate = POLICY[entity]?.[action];
  if (!predicate) return false;
  return predicate(ctx.realRole, ctx);
}
