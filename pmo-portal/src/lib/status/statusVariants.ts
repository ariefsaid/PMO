import type { StatusVariant } from '@/src/components/ui/StatusPill';

/**
 * CW-2 — the single status / colour registry (one source of truth for every
 * status, severity, and category across ALL modules).
 *
 * THE binding rule (DESIGN.md "The Freed-Blue Status Rule"): the action-blue
 * (`open` StatusPill variant, `bg-primary/10`) is RESERVED for the one interactive
 * affordance — **no status, severity, or category pill may use it.** Colour is for
 * exceptions only; open/active/in-progress is a NEUTRAL grey `progress` pill whose
 * distinct LABEL carries identity (so it is never colour-only).
 *
 * Three independent families, never sharing one another's tints:
 *  A. Workflow status     → `workflowVariant`
 *  B. Severity / risk     → `severityVariant`
 *  C. Categorical / type  → `categoryVariant` (+ `companyTypeVariant` / `crmActivityVariant`)
 *
 * Modules import from here instead of defining a local `Record<…, StatusVariant>`.
 */

// ───────────────────────────────────────────────────────────────────────────
// A. Workflow status (one map, ALL modules — Procurement / Projects / Documents /
//    Timesheets / Tasks / Incidents / Budget). Family → token:
//      open/active/in-progress/pending → progress (neutral grey, NOT blue)
//      awaiting-action / needs-you     → warn   (amber)
//      done/won/approved/paid/complete → won    (green)
//      lost/rejected/cancelled/failed  → lost   (red)
//      closed/terminal-neutral         → neutral
//      draft                           → draft
//      superseded                      → superseded
// ───────────────────────────────────────────────────────────────────────────

/** Canonical workflow-status → variant map, keyed by each module's enum value. */
const WORKFLOW_VARIANT: Record<string, StatusVariant> = {
  // ── Drafts (pre-flight) ─────────────────────────────────────────────────
  Draft: 'draft',

  // ── Sales Invoice statuses ──────────────────────────────────────────────
  Submitted: 'progress',
  Unpaid: 'warn',
  Paid: 'won',
  Cancelled: 'lost',

  // ── Done / positive-terminal → green ────────────────────────────────────
  Approved: 'won',
  Done: 'won',
  Complete: 'won',
  Completed: 'won',
  Active: 'won', // budget version "Active" = the live/effective version
  'Won, Pending KoM': 'won',
  'Close Out': 'won',

  // ── Lost / negative-terminal → red ──────────────────────────────────────
  Rejected: 'lost',
  Failed: 'lost',
  Blocked: 'lost',
  'Loss Tender': 'lost',

  // ── Awaiting-action / at-risk → amber ───────────────────────────────────
  'On Hold': 'warn',

  // ── Closed / terminal-neutral / superseded ──────────────────────────────
  Closed: 'neutral',
  Archived: 'neutral',
  Superseded: 'superseded',

  // ── Open / active / in-progress / pending → neutral grey (FREED BLUE) ────
  // The distinct label carries identity; no in-flight state uses the action-blue.
  Open: 'progress',
  Investigating: 'progress',
  'In Progress': 'progress',
  'To Do': 'neutral', // not-yet-started → quiet neutral (distinct from in-flight grey by label)
  Issued: 'progress',
  'PO Issued': 'progress',
  'Goods Received': 'progress',
  Ongoing: 'progress',
  'Ongoing Project': 'progress',
  'Internal Project': 'progress',
  Leads: 'draft',
  'PQ Submitted': 'draft',
  'Quotation Submitted': 'draft',
  'Tender Submitted': 'draft',
  Negotiation: 'draft',
};

/**
 * Workflow status → tinted StatusPill variant. Unknown values fall back to
 * `neutral` (never the action-blue). The LABEL always renders alongside, so the
 * neutral-grey "open/active" remap is never colour-only.
 */
export function workflowVariant(status: string): StatusVariant {
  return WORKFLOW_VARIANT[status] ?? 'neutral';
}

// ───────────────────────────────────────────────────────────────────────────
// B. Severity / risk (its own ramp — never blue, never a workflow tint's meaning)
//      Low → neutral · Medium/High → warn (amber) · Critical → lost (red)
// ───────────────────────────────────────────────────────────────────────────

type Severity = 'Low' | 'Medium' | 'High' | 'Critical';

const SEVERITY_VARIANT: Record<Severity, StatusVariant> = {
  Low: 'neutral',
  Medium: 'warn',
  High: 'warn',
  Critical: 'lost',
};

/** Severity → tinted variant. Fixes the Incidents Medium===Open===action-blue collision. */
export function severityVariant(sev: string): StatusVariant {
  return SEVERITY_VARIANT[sev as Severity] ?? 'neutral';
}

// ───────────────────────────────────────────────────────────────────────────
// C. Categorical / type / activity-kind (non-interactive classification —
//    `violet` for the highlighted kind + `neutral` for the rest, NEVER blue,
//    never a workflow tint).
// ───────────────────────────────────────────────────────────────────────────

/**
 * Generic categorical helper: the one highlighted kind reads `violet`, every
 * other kind reads `neutral`. Pass the value and the single highlighted kind.
 */
export function categoryVariant(kind: string, highlighted: string): StatusVariant {
  return kind === highlighted ? 'violet' : 'neutral';
}

/** Company type pill: Client highlighted (violet), Vendor/Internal neutral — never blue. */
export function companyTypeVariant(type: string): StatusVariant {
  return categoryVariant(type, 'Client');
}

/** CRM activity-kind pill: Call highlighted (violet), the rest neutral — never blue. */
export function crmActivityVariant(kind: string): StatusVariant {
  return categoryVariant(kind, 'Call');
}

// ───────────────────────────────────────────────────────────────────────────
// D. Module-specific categorical pills (migrated from local maps — CW-2
//    consolidation). Each follows the same rule: categorical tints only
//    (violet for highlighted, neutral for the rest — never workflow-green
//    or the action-blue).
// ───────────────────────────────────────────────────────────────────────────

/**
 * User role pill — neutral-only. The role label carries identity; no single role is
 * visually elevated as a category accent, and no role borrows workflow/status colours.
 */
const ROLE_VARIANT: Record<string, StatusVariant> = {
  Admin: 'neutral',
  Executive: 'neutral',
  'Project Manager': 'neutral',
  Finance: 'neutral',
  Engineer: 'neutral',
};

/** User role → categorical StatusPill variant. Unknown roles fall back to `neutral`. */
export function roleVariant(role: string): StatusVariant {
  return ROLE_VARIANT[role] ?? 'neutral';
}

/**
 * Budget version status pill — aligned to the workflow registry (Active→green,
 * Draft→amber, Archived→neutral). Migrated from the local `VERSION_PILL` map
 * in `ProjectBudget.tsx` to close the last local-map bypass.
 */
const BUDGET_VERSION_VARIANT: Record<string, StatusVariant> = {
  Active: 'won',    // effective/live version → positive-terminal green
  Draft: 'warn',    // awaiting finalization → amber
  Archived: 'neutral', // superseded version → quiet grey
};

/** Budget version status → tinted StatusPill variant. Unknown statuses fall back to `neutral`. */
export function budgetVersionVariant(status: string): StatusVariant {
  return BUDGET_VERSION_VARIANT[status] ?? 'neutral';
}

/** Sales Invoice status → tinted StatusPill variant. Unknown statuses fall back to `neutral`. */
export function salesInvoiceStatusVariant(status: string): StatusVariant {
  return WORKFLOW_VARIANT[status] ?? 'neutral';
}

// ───────────────────────────────────────────────────────────────────────────
// Test/guard surface: every variant the registry can ever resolve to. The
// Freed-Blue guard asserts `open` is not among them.
// ───────────────────────────────────────────────────────────────────────────

/** Every variant the three families can resolve to — the no-action-blue guard reads this. */
export const ALL_REGISTRY_VARIANTS: readonly StatusVariant[] = [
  ...new Set<StatusVariant>([
    ...Object.values(WORKFLOW_VARIANT),
    ...Object.values(SEVERITY_VARIANT),
    ...Object.values(ROLE_VARIANT),
    ...Object.values(BUDGET_VERSION_VARIANT),
    'violet',
    'neutral',
  ]),
];
