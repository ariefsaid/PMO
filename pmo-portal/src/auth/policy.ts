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
  | 'editContractValue';

export type Entity =
  | 'project'
  | 'company'
  | 'procurement'
  | 'procItem'
  | 'quotation'
  | 'procDoc'
  | 'task'
  | 'taskStatus'
  | 'incident'
  | 'incidentClose'
  | 'document'
  | 'documentStatus'
  | 'budgetLine'
  | 'user'
  | 'timesheet'
  | 'approval';

export interface PolicyContext {
  /** The REAL JWT role (not the impersonated effectiveRole). */
  realRole: Role | null;
  /** The current user's id — for record-scoped checks (own task, requester, author). */
  currentUserId?: string | null;
  /** The record under consideration — for status/ownership-conditional rules. */
  record?: {
    status?: string | null;
    assignee_id?: string | null;
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
    edit: allow(MASTER_DATA), // authorship checked at the call-site
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
  },
  approval: {
    transition: allow(DELIVERY), // approve others' timesheets; !self enforced at the call-site + RPC
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
