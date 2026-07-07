/**
 * readEntities.ts — the agent read-tool whitelist + row cap. A dependency-free LEAF module.
 *
 * These live here, not in actions.ts, to break a circular import: schema.ts builds QUERY_ENTITY_SCHEMA
 * from AGENT_READ_ENTITIES at module scope, and actions.ts imports the schema objects from schema.ts —
 * so actions.ts ↔ schema.ts is a cycle. When the deployed edge worker bundled + evaluated schema.ts
 * before actions.ts finished initializing, `AGENT_READ_ENTITIES` was read in its temporal dead zone and
 * the worker crashed at boot (WORKER_ERROR, prod deploy 2026-07-04). A leaf module (no imports) can
 * never participate in a cycle, so it is always initialized first. Keep this file dependency-free.
 *
 * Defect 2 (read-scope broadening): the agent exposes every RLS-readable business entity the user can
 * ask about — not just projects/companies. RLS is STILL the enforcement authority: every read goes
 * through the caller-JWT client, so RLS caps every row (the agent adds no privilege). The catalogue
 * below is split in two:
 *   - The 5 entities reused verbatim from the compose-view ENTITY_WHITELIST (projects, companies,
 *     tasks, incidents, contacts) — those keep their audited column sets; ENTITY_WHITELIST stays the
 *     source of truth for them (resolved in entityCatalog.ts, which CAN import ENTITY_WHITELIST;
 *     this leaf cannot).
 *   - The 3 agent-curated entities below (procurements, milestones, timesheets) — not in
 *     ENTITY_WHITELIST, so their conservative column allowlists live right here (pure data, no imports).
 *     Columns are curated to expose ONLY business-read fields — NEVER the org_id tenancy seam, NEVER
 *     internal/audit/PII-risk columns (approval rationale, etc.).
 *
 * Entities deliberately NOT exposed (see the Defect-2 report): user_views (meta, not business data),
 * budget_versions/budget_line_items (budget amounts are already readable via projects.budget/spent),
 * timesheet_entries (granular hours; the `timesheets` summary covers the common ask),
 * crm_activities (a write target, not a v1 read need), and the procurement sub-tables (the `procurements`
 * case summary covers the common ask). Each newly-exposed table was confirmed to have RLS enabled +
 * an org/owner-scoped SELECT policy before being added (grep the migrations).
 */

/** Whitelisted entity keys available to the agent read tool. */
export const AGENT_READ_ENTITIES = [
  // Reused from ENTITY_WHITELIST (audited column sets; resolved in entityCatalog.ts):
  'projects',
  'companies',
  'tasks',
  'incidents',
  'contacts',
  // Agent-curated (column allowlists in AGENT_ENTITY_TABLES below):
  'procurements',
  'milestones',
  'timesheets',
  'crm_activities',
  // Procure-to-pay lifecycle records (each RLS-scoped; columns curated below):
  'purchase_requests',
  'rfqs',
  'procurement_quotations',
  'purchase_orders',
  'procurement_receipts',
  'procurement_invoices',
  'payments',
  'procurement_items',
  'procurement_status_events',
  // Planning / spend / team / docs / alerts:
  'budget_line_items',
  'project_documents',
  'procurement_documents',
  'profiles',
  'notifications',
] as const;
export type AgentReadEntity = (typeof AGENT_READ_ENTITIES)[number];

/** Hard row cap — the effective limit is min(input.limit ?? CAP, CAP). */
export const AGENT_READ_ROW_CAP = 50;

/**
 * Agent-curated entity catalogue for the entities NOT covered by ENTITY_WHITELIST. Pure data
 * (dependency-free) so this file stays a leaf. Columns are conservative: business-read fields only.
 *
 * - `table`: the real Postgres table the caller-JWT client reads from (RLS caps every row).
 * - `allowedColumns`: the only columns a query may SELECT or FILTER on. `org_id` is intentionally
 *   absent on every entry — the tenancy seam is never surfaced to the model.
 */
export interface AgentCuratedEntity {
  table: string;
  allowedColumns: readonly string[];
}

export const AGENT_ENTITY_TABLES: Readonly<Record<string, AgentCuratedEntity>> = Object.freeze({
  // Procurement cases (procure-to-pay folders). Excludes org_id (tenancy), pr_number/po_number
  // (internal system IDs beyond the primary `code`), approval_notes/rejection_notes (sensitive
  // approver rationale), approved_by_id/vendor_invoiced_at (audit trails).
  procurements: {
    table: 'procurements',
    allowedColumns: [
      'id', 'code', 'title', 'project_id', 'requested_by_id',
      'status', 'total_value', 'vendor_id', 'created_at',
    ],
  },
  // Project milestones (named delivery chunks). Excludes org_id (tenancy) and sort_order (internal).
  milestones: {
    table: 'project_milestones',
    allowedColumns: ['id', 'project_id', 'name', 'target_date', 'weight', 'input_pct', 'created_at'],
  },
  // Timesheet headers (week + approval state). Excludes org_id (tenancy); approved_by is omitted to
  // keep the read summary-level (the owner is already implied by user_id; hours live in
  // timesheet_entries, deliberately not exposed).
  timesheets: {
    table: 'timesheets',
    allowedColumns: ['id', 'user_id', 'week_start_date', 'status', 'submitted_at', 'approved_at'],
  },
  // CRM activity log (calls/emails/meetings/notes against a company/contact/project). The read
  // counterpart to the create_activity write — lets the agent answer "what activity is there on
  // this deal?". Excludes org_id (tenancy). `subject`+`body` are the user's OWN logged notes
  // (RLS-scoped to their access), so surfacing them is in-scope; `kind` is the activity type.
  crm_activities: {
    table: 'crm_activities',
    allowedColumns: [
      'id', 'contact_id', 'company_id', 'project_id', 'kind',
      'subject', 'body', 'occurred_at', 'logged_by_id', 'created_at',
    ],
  },

  // ── Procure-to-pay lifecycle ────────────────────────────────────────────────
  // Each record links to its procurement case via procurement_id (RLS caps rows to the caller's
  // access). Every entry EXCLUDES: org_id (tenancy seam); import_batch_id/imported_at/import_key
  // (internal ETL plumbing); file_url/link (raw storage refs). Business doc number + status +
  // amount + date are the fields a user asks about ("where's the PO?", "was it paid?").
  purchase_requests: {
    table: 'purchase_requests',
    allowedColumns: ['id', 'procurement_id', 'pr_number', 'reference_number', 'status', 'date', 'amount', 'created_at'],
  },
  rfqs: {
    table: 'rfqs',
    allowedColumns: ['id', 'procurement_id', 'rfq_number', 'reference_number', 'status', 'date', 'amount', 'created_at'],
  },
  // Vendor quotations. Excludes file_url (raw storage) + org_id + import_* plumbing.
  procurement_quotations: {
    table: 'procurement_quotations',
    allowedColumns: [
      'id', 'procurement_id', 'rfq_id', 'vendor_id', 'vq_number', 'reference',
      'total_amount', 'received_date', 'valid_until', 'is_selected',
    ],
  },
  purchase_orders: {
    table: 'purchase_orders',
    allowedColumns: ['id', 'procurement_id', 'po_number', 'reference_number', 'status', 'date', 'amount', 'created_at'],
  },
  // Goods receipts (GRN). po_id links to the ordering PO.
  procurement_receipts: {
    table: 'procurement_receipts',
    allowedColumns: ['id', 'procurement_id', 'po_id', 'gr_number', 'reference_number', 'status', 'receipt_date', 'created_at'],
  },
  procurement_invoices: {
    table: 'procurement_invoices',
    allowedColumns: ['id', 'procurement_id', 'po_id', 'vi_number', 'reference_number', 'status', 'invoice_date', 'amount', 'created_at'],
  },
  payments: {
    table: 'payments',
    allowedColumns: ['id', 'procurement_id', 'invoice_id', 'pay_number', 'reference_number', 'status', 'date', 'amount', 'created_at'],
  },
  // Line items within a procurement case (name/qty/rate/amount). Capped at the row cap like any read.
  procurement_items: {
    table: 'procurement_items',
    allowedColumns: ['id', 'procurement_id', 'name', 'description', 'quantity', 'rate', 'amount'],
  },
  // Procurement status history (the case's stage transitions). Excludes `notes` (approver
  // rationale — sensitive, consistent with procurements' excluded approval_notes) + org_id.
  procurement_status_events: {
    table: 'procurement_status_events',
    allowedColumns: ['id', 'procurement_id', 'from_status', 'to_status', 'actor_id', 'created_at'],
  },

  // ── Spend detail / docs / team / alerts ─────────────────────────────────────
  // Budget line items (category-level budgeted vs actual). Linked via budget_version_id.
  budget_line_items: {
    table: 'budget_line_items',
    allowedColumns: ['id', 'budget_version_id', 'category', 'description', 'budgeted_amount', 'actual_amount'],
  },
  // Project document METADATA only — never the file. Excludes file_path (raw storage), org_id,
  // parent_document_id (internal revision linkage).
  project_documents: {
    table: 'project_documents',
    allowedColumns: [
      'id', 'project_id', 'code', 'category', 'title', 'revision',
      'status', 'doc_date', 'author_id', 'created_at',
    ],
  },
  // Procurement document metadata. Excludes link (raw storage) + org_id.
  procurement_documents: {
    table: 'procurement_documents',
    allowedColumns: ['id', 'procurement_id', 'type', 'reference_number', 'status', 'date'],
  },
  // Team directory (resolve "who is the PM/assignee"). Excludes org_id (tenancy) + email &
  // avatar_url (PII / raw storage) + skills/utilization (not needed for identity) + timestamps.
  profiles: {
    table: 'profiles',
    allowedColumns: ['id', 'full_name', 'role', 'title', 'location', 'company_id', 'manager_id', 'status'],
  },
  // The caller's own notifications (owner_id is RLS-implied). Excludes org_id + metadata (internal JSON).
  notifications: {
    table: 'notifications',
    allowedColumns: ['id', 'severity', 'title', 'body', 'read_at', 'created_at'],
  },
});
