import { supabase } from '@/src/lib/supabase/client';
import { fetchAllPages } from '@/src/lib/pagedRead';
import { Constants, type Database, type Tables, type Json } from '@/src/lib/supabase/database.types';
import { AppError, assertWriteLanded, toAppError } from '@/src/lib/appError';
import { activateAndPush } from '@/src/lib/budget/budgetPushConsequence';
import { dispatchDomainCommand } from '@/src/lib/adapterSeam/dispatchClient';
import type { PmoRecord } from '@/src/lib/adapterSeam/contract';
import { assertMicrosoftReference, type MicrosoftReferenceInput } from '@/src/lib/m365/reference';
import type { BudgetActivationPrecheckResult } from '@/src/lib/budget/budgetGate';

// ---------------------------------------------------------------------------
// Type contract (plan §3 "Type contract used across tasks")
// ---------------------------------------------------------------------------

export type BudgetVersionRow = Tables<'budget_versions'>;
export type BudgetLineItemRow = Tables<'budget_line_items'>;
export type BudgetDocumentLinkRow = Tables<'budget_version_document_links'>;
export type BudgetActivationMode = 'allowed' | 'sole_operator' | 'blocked' | 'blocked_editor' | 'blocked_no_drafter';
/** The persisted budget-mode column (0576 check constraint). `per_year` is the historic default. */
export type BudgetVersionMode = 'whole_project' | 'per_year';

/** Exact source-line witness sent with an explicit Draft budget-mode change. */
export interface BudgetModeSwitchLineWitness {
  id: string;
  category: BudgetLineItemRow['category'];
  budgeted_amount: string;
  fiscal_year: string | null;
}

export interface BudgetModeSwitchAssignment {
  id: string;
  fiscal_year: string;
}

// ---------------------------------------------------------------------------
// Distribution plan contract (#1472 S6A) — the accepted S3 API
// (`save_budget_distribution`, migration 0577). Amounts travel as EXACT decimal
// strings end to end; the server owns every validation and the org stamp.
// ---------------------------------------------------------------------------

export type BudgetDistributionMethod = 'by_days' | 'percent_by_year' | 'amount_by_year';

/** One basis fiscal year: the org's actual ERP fiscal-year name and its date span. */
export interface BudgetDistributionBasisYear {
  name: string;
  start: string;
  end: string;
}

/** The exact date/calendar basis a plan was computed against (staleness oracle). */
export interface BudgetDistributionBasis {
  projectStart: string;
  projectEnd: string | null;
  years: BudgetDistributionBasisYear[];
}

/** Budget-wide entered weights: basis-year name → the operator's exact decimal string. */
export type BudgetDistributionInputs = Record<string, string>;

/** A per-category override: its own method and its own entered vector. */
export interface BudgetCategoryOverride {
  method: BudgetDistributionMethod;
  inputs: BudgetDistributionInputs;
}
export type BudgetCategoryOverrides = Record<string, BudgetCategoryOverride>;

export interface BudgetDistributionPlanRow {
  category: BudgetLineItemRow['category'];
  fiscal_year: string;
  /** Zero-based position of this year in the basis (server-validated). */
  ordinal: number;
  /** EXACT decimal string — never a JS float (NFR-001). */
  amount: string;
  method: BudgetDistributionMethod;
  is_override: boolean;
}

/** One whole-project distribution snapshot: exactly what the save RPC persists and the read returns. */
export interface BudgetDistributionPlan {
  method: BudgetDistributionMethod;
  inputs: BudgetDistributionInputs;
  categoryOverrides: BudgetCategoryOverrides;
  basis: BudgetDistributionBasis;
  rows: BudgetDistributionPlanRow[];
}

export type BudgetVersionWithItems = BudgetVersionRow & {
  /** All line-items belonging to this version. */
  line_items: BudgetLineItemRow[];
  /** Σ budgeted_amount of this version's line-items, normalised to JS number. */
  total: number;
  /** All recorded human editors, used only for the activation affordance; the RPC remains authoritative. */
  editor_ids: string[];
};

/** What activating (or retrying the push for) a version did to the ERPNext side (HIGH-C). The PMO
 *  transition itself either succeeded or threw — this only ever describes the push CONSEQUENCE. */
export interface ActivateVersionResult {
  /**
   * ⚑ `'nothing-to-push'` (FU-2 round 2) is a THIRD outcome, not a flavour of the other two. A version
   * with no line items produces an EMPTY push plan: the served fan-out attempts no year, creates no ERP
   * `Budget` and writes no mirror row, then answers `200 { years: [] }`. Reading that as `'pushed'`
   * announced a push that never happened (the per-year banner underneath simultaneously said
   * `never-pushed`); reading it as `'failed'` would invent an attempt that was never made. Nothing was
   * sent because there was nothing to send, and the surface says exactly that.
   *
   * ⚑ `'pending-cancellation'` (rm-1472) is a FOURTH outcome for the same reason: the served gate
   * answers `202 { error: 'budget-cancellation-pending' }` while a predecessor's ERPNext cancellation
   * is still settling — the activation stands, the units are queued, and NOTHING has been pushed yet.
   * The sweep resumes the push by itself once the cancellation settles, so this is "queued", neither a
   * success nor a failure the operator must fix.
   */
  pushState: 'pushed' | 'failed' | 'nothing-to-push' | 'pending-cancellation';
}

export interface ArchiveVersionResult {
  /** The choice saved by the first successful archive request. */
  cancelErp: boolean;
  /** Known potentially live ERPNext budgets observed and committed with the archive request. */
  liveTargetCount: number;
  /** Durable cancellation intents recorded for the sweep. */
  queuedCount: number;
}

export type BudgetArchiveLiveTarget = {
  id: string;
  budget_version_id: string;
  fiscal_year: string;
  to_fiscal_year: string | null;
  /** '' for a LEGACY (year-grained) document — never invented from a category map. */
  erp_account: string;
  erp_budget_name: string | null;
  erp_docstatus: number | null;
  erp_cancelled_at: string | null;
  push_state: string;
  budget_intent: 'ensure' | 'remove';
  activated_at_witness: string | null;
  /** #1462 — which mirror kind this row came from; `legacy` predates the account-grained push. */
  source_kind: 'account' | 'legacy';
  /** True only while this org's active ERPNext binding can cancel THIS kind (v16 for account, v15 for legacy). */
  archive_cancellation_available: boolean;
};
type BudgetArchiveMirrorTarget = Omit<BudgetArchiveLiveTarget, 'archive_cancellation_available' | 'source_kind'>;

/**
 * #1462 — one conservative archive-cancellation candidate, as the SERVER sees it.
 *
 * `eligible` is the server's answer (the same locked predicates the archive transaction re-checks), and
 * `reason` is a safe code the surface may explain generically. The browser never re-derives eligibility.
 */
type BudgetArchiveTargetRpcRow = Database['public']['Functions']['get_budget_archive_targets']['Returns'][number];
export type BudgetArchiveTarget = Omit<BudgetArchiveTargetRpcRow, 'page_key' | 'source_kind'> & {
  source_kind: 'account' | 'legacy';
};

export interface NewLineItem {
  category: BudgetLineItemRow['category'];
  description: string | null;
  budgeted_amount: number;
  /**
   * ⚑ BFY FR-BFY-060 — the ERPNext `Fiscal Year` NAME this line is phased to; `null`/omitted = un-phased.
   *
   * Optional and NULL-by-default on purpose: every existing line stays un-phased, and PMO never invents
   * a year for a line the operator deliberately left alone (ADR-0048). The value is the client's own
   * label ('2026', '2025-2026', …) and is validated at PUSH time against their live `Fiscal Year`
   * doctype — never here, because the write path cannot reach another system's calendar (FR-BFY-022).
   */
  fiscal_year?: string | null;
}

/**
 * Import provenance stamps (0195). Supplied ONLY by the bulk-import path; every other caller omits
 * the argument and the three columns stay NULL, which is what keeps them out of the partial unique
 * indexes and leaves every existing write path byte-identical.
 *
 * ⚑ `importKey` is optional on purpose (DD-BIMP-5): a VERSION carries the batch stamps but no key,
 * because a version's identity is "this project's open Draft", not a row in a sheet — key it and the
 * second legitimate import for a project, after the first was activated, is blocked forever by a row
 * that is no longer Draft. The line items carry the key.
 */
export interface ImportProvenance {
  importBatchId: string;
  importedAt: string;
  importKey?: string | null;
}

export interface BudgetImportRequest {
  versionId: string;
  item: NewLineItem;
  batchId: string;
  importedAt: string;
  v2Key: string;
  legacyKey: string;
  hasReference: boolean;
}

export async function importBudgetLine(request: BudgetImportRequest): Promise<{ outcome: 'created' | 'skipped' | 'conflict'; line_id: string }> {
  const { item } = request;
  const { data, error } = await supabase.rpc('import_budget_line_v2', {
    p_version_id: request.versionId, p_category: item.category,
    p_description: item.description as string, p_budgeted_amount: item.budgeted_amount,
    p_fiscal_year: (item.fiscal_year ?? null) as string,
    p_batch_id: request.batchId, p_imported_at: request.importedAt,
    p_v2_key: request.v2Key, p_legacy_key: request.legacyKey, p_has_reference: request.hasReference,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row || (!['created', 'skipped', 'conflict'].includes(row.outcome) || typeof row.line_id !== 'string' || !row.line_id)) throw new Error('Unexpected budget import result');
  return row as { outcome: 'created' | 'skipped' | 'conflict'; line_id: string };
}

// ---------------------------------------------------------------------------
// Phase B — reads
// ---------------------------------------------------------------------------

/**
 * Returns the derived project budget: Σ budgeted_amount of all line-items on
 * the project's Active version (FR-BV-001). Zero when no Active version exists
 * (FR-BV-002). The stale `projects.budget` header is never read (FR-BV-003).
 * org_id is NEVER sent — RLS scopes via `auth_org_id()` (NFR-BV-PERF-001).
 */
export async function getBudgetActivationMode(versionId: string): Promise<BudgetActivationMode> {
  const { data, error } = await supabase.rpc('budget_activation_mode', { version_id: versionId });
  if (error) throw toAppError(error);
  const modes: readonly BudgetActivationMode[] = ['allowed', 'sole_operator', 'blocked', 'blocked_editor', 'blocked_no_drafter'];
  if (!modes.includes(data as BudgetActivationMode)) throw new Error('Unexpected budget activation mode');
  return data as BudgetActivationMode;
}

/** One Draft budget awaiting review in the org-wide "Review and activate drafts" list (#1273). */
export interface OrgDraftBudget {
  id: string;
  projectId: string;
  projectCode: string | null;
  projectName: string;
  currency: string;
  version: number;
  name: string;
  total: number;
  createdBy: string | null;
  editorIds: string[];
  documentUrl: string | null;
  /** What the whole-project distribution gate needs (the same inputs the Budget tab reads). */
  budgetMode: BudgetVersionMode;
  projectStart: string | null;
  projectEnd: string | null;
  lines: Pick<BudgetLineItemRow, 'category' | 'budgeted_amount'>[];
}

const DRAFT_READ_CHUNK = 100;

/**
 * Every Draft budget version in the caller's org (RLS-scoped; org_id never sent) with its project,
 * line-item total, editors and first linked source document. Read only: activation stays the
 * per-budget `activateVersion` path.
 */
export async function listOrgDraftBudgets(): Promise<OrgDraftBudget[]> {
  const versions = await fetchAllPages((from, to) => supabase.from('budget_versions')
    .select('id,project_id,version,name,created_by,budget_mode,projects(code,name,currency,start_date,end_date)').eq('status', 'Draft')
    .order('id', { ascending: true }).range(from, to));
  if (!versions.length) return [];
  const ids = versions.map((v) => v.id);
  const totals = new Map<string, number>();
  const lineRows = new Map<string, OrgDraftBudget['lines']>();
  const editors = new Map<string, string[]>();
  const docs = new Map<string, string>();
  for (let i = 0; i < ids.length; i += DRAFT_READ_CHUNK) {
    const chunk = ids.slice(i, i + DRAFT_READ_CHUNK);
    const [lines, eds, links] = await Promise.all([
      fetchAllPages((from, to) => supabase.from('budget_line_items').select('id,budget_version_id,category,budgeted_amount')
        .in('budget_version_id', chunk).order('id', { ascending: true }).range(from, to)),
      fetchAllPages((from, to) => supabase.from('budget_version_editors').select('budget_version_id,user_id')
        .in('budget_version_id', chunk).order('budget_version_id', { ascending: true }).order('user_id', { ascending: true }).range(from, to)),
      fetchAllPages((from, to) => supabase.from('budget_version_document_links').select('id,budget_version_id,ms_web_url')
        .in('budget_version_id', chunk).order('ms_linked_at', { ascending: true }).order('id', { ascending: true }).range(from, to)),
    ]);
    for (const l of lines) {
      totals.set(l.budget_version_id, (totals.get(l.budget_version_id) ?? 0) + Number(l.budgeted_amount));
      lineRows.set(l.budget_version_id, [...(lineRows.get(l.budget_version_id) ?? []), { category: l.category, budgeted_amount: l.budgeted_amount }]);
    }
    for (const e of eds) editors.set(e.budget_version_id, [...(editors.get(e.budget_version_id) ?? []), e.user_id]);
    for (const d of links) if (!docs.has(d.budget_version_id)) docs.set(d.budget_version_id, d.ms_web_url);
  }
  return versions.map((v) => {
    const project = Array.isArray(v.projects) ? v.projects[0] : v.projects;
    return {
      id: v.id,
      projectId: v.project_id,
      projectCode: project?.code ?? null,
      projectName: project?.name ?? '',
      currency: project?.currency ?? '',
      version: v.version,
      name: v.name,
      total: totals.get(v.id) ?? 0,
      createdBy: v.created_by,
      editorIds: editors.get(v.id) ?? [],
      documentUrl: docs.get(v.id) ?? null,
      budgetMode: v.budget_mode === 'whole_project' ? 'whole_project' : 'per_year',
      projectStart: project?.start_date ?? null,
      projectEnd: project?.end_date ?? null,
      lines: lineRows.get(v.id) ?? [],
    };
  });
}

/** Read-only, caller-authenticated readiness check for a Draft budget activation confirmation. */
export async function precheckBudgetActivation(versionId: string): Promise<BudgetActivationPrecheckResult> {
  const { data, error } = await supabase.functions.invoke<BudgetActivationPrecheckResult>('adapter-dispatch', {
    body: { action: 'budget-activation-precheck', versionId },
  });
  if (error) throw toAppError(error);
  if (!data || !['ready', 'blocked', 'erp-unavailable'].includes(data.status)) {
    throw new AppError('Budget readiness check returned an unexpected response');
  }
  return data;
}

export async function deriveProjectBudget(projectId: string): Promise<number> {
  const { data, error } = await supabase.rpc('get_project_budget', {
    p_project_id: projectId,
  });
  if (error) throw toAppError(error);
  return Number(data);
}

// ---------------------------------------------------------------------------
// Distribution plan reads/writes (#1472 S6A)
// ---------------------------------------------------------------------------

function isJsonObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const DISTRIBUTION_METHODS: readonly BudgetDistributionMethod[] = ['by_days', 'percent_by_year', 'amount_by_year'];
const BUDGET_CATEGORIES: readonly string[] = Constants.public.Enums.budget_category;

function isBudgetCategory(value: unknown): value is BudgetLineItemRow['category'] {
  return typeof value === 'string' && BUDGET_CATEGORIES.includes(value);
}

function parseDistributionMethod(value: unknown, what: string): BudgetDistributionMethod {
  if (typeof value !== 'string' || !DISTRIBUTION_METHODS.includes(value as BudgetDistributionMethod)) {
    throw new AppError(`Saved budget distribution is malformed: ${what}`);
  }
  return value as BudgetDistributionMethod;
}

function parseDistributionInputs(value: unknown, what: string): BudgetDistributionInputs {
  if (!isJsonObject(value)) throw new AppError(`Saved budget distribution is malformed: ${what}`);
  const inputs: BudgetDistributionInputs = {};
  for (const [year, entered] of Object.entries(value)) {
    if (typeof entered !== 'string') throw new AppError(`Saved budget distribution is malformed: ${what}`);
    inputs[year] = entered;
  }
  return inputs;
}

function parseDistributionBasis(value: unknown): BudgetDistributionBasis {
  if (!isJsonObject(value)) throw new AppError('Saved budget distribution is malformed: basis');
  const { projectStart, projectEnd, years } = value;
  if (typeof projectStart !== 'string' || !(projectEnd === null || typeof projectEnd === 'string') || !Array.isArray(years)) {
    throw new AppError('Saved budget distribution is malformed: basis');
  }
  return {
    projectStart,
    projectEnd,
    years: years.map((year) => {
      if (!isJsonObject(year) || typeof year.name !== 'string' || typeof year.start !== 'string' || typeof year.end !== 'string') {
        throw new AppError('Saved budget distribution is malformed: basis year');
      }
      return { name: year.name, start: year.start, end: year.end };
    }),
  };
}

function parseCategoryOverrides(value: unknown): BudgetCategoryOverrides {
  if (!isJsonObject(value)) throw new AppError('Saved budget distribution is malformed: category overrides');
  const overrides: BudgetCategoryOverrides = {};
  for (const [category, override] of Object.entries(value)) {
    if (!isJsonObject(override)) throw new AppError(`Saved budget distribution is malformed: override for ${category}`);
    overrides[category] = {
      method: parseDistributionMethod(override.method, `override method for ${category}`),
      inputs: parseDistributionInputs(override.inputs, `override inputs for ${category}`),
    };
  }
  return overrides;
}

function parseDistributionRows(value: unknown): BudgetDistributionPlanRow[] {
  if (!Array.isArray(value)) throw new AppError('Saved budget distribution is malformed: rows');
  return value.map((row, index) => {
    if (!isJsonObject(row)
      || !isBudgetCategory(row.category)
      || typeof row.fiscal_year !== 'string'
      || row.fiscal_year.length === 0
      || typeof row.ordinal !== 'number'
      || !Number.isInteger(row.ordinal)
      || row.ordinal < 0
      || typeof row.amount !== 'string'
      || typeof row.is_override !== 'boolean') {
      throw new AppError(`Saved budget distribution is malformed: row ${index}`);
    }
    return {
      category: row.category,
      fiscal_year: row.fiscal_year,
      ordinal: row.ordinal,
      amount: row.amount,
      method: parseDistributionMethod(row.method, `row method at ${index}`),
      is_override: row.is_override,
    };
  });
}

/**
 * Reads one version's whole-project distribution from one tenant-scoped SQL statement. Plan fields
 * and every ordered row share the statement snapshot; the row aggregate is one JSON value, so the
 * PostgREST response-row limit cannot silently cap the distribution. A version without a visible
 * plan reads as `null`; any read failure propagates. org_id is NEVER sent — invoker RLS scopes the
 * plan and rows via the existing policies (NFR-002).
 */
export async function getBudgetDistribution(versionId: string): Promise<BudgetDistributionPlan | null> {
  const { data, error } = await supabase.rpc('get_budget_distribution_snapshot', { p_version_id: versionId });
  if (error) throw toAppError(error);
  if (data === null) return null;
  if (!isJsonObject(data)) throw new AppError('Saved budget distribution is malformed: snapshot');
  return {
    method: parseDistributionMethod(data.method, 'method'),
    inputs: parseDistributionInputs(data.inputs, 'inputs'),
    categoryOverrides: parseCategoryOverrides(data.category_overrides),
    basis: parseDistributionBasis(data.basis),
    rows: parseDistributionRows(data.rows),
  };
}

/**
 * Saves one distribution snapshot atomically via the accepted S3 RPC (0577, six-argument form with
 * per-category overrides). Rows, basis, inputs and overrides pass through VERBATIM — exact decimal
 * strings, no numeric conversion, no invented fields. org_id is NEVER sent; the definer RPC stamps
 * the org, validates the whole snapshot under lock against the live source lines, and records the
 * editor (NFR-002). A rejection throws — the caller keeps its entered values and re-reviews.
 */
export async function saveBudgetDistribution(versionId: string, plan: BudgetDistributionPlan): Promise<void> {
  // The wire format is jsonb; these rebuilds copy each field VERBATIM (no numeric conversion, no
  // re-shaping) — they exist only to give the typed structures Json's index signature honestly.
  const basisJson: Json = {
    projectStart: plan.basis.projectStart,
    projectEnd: plan.basis.projectEnd,
    years: plan.basis.years.map((year) => ({ name: year.name, start: year.start, end: year.end })),
  };
  const overridesJson: Json = Object.fromEntries(
    Object.entries(plan.categoryOverrides).map(([category, override]) => [
      category,
      { method: override.method, inputs: { ...override.inputs } },
    ]),
  );
  const { error } = await supabase.rpc('save_budget_distribution', {
    p_version: versionId,
    p_method: plan.method,
    p_inputs: { ...plan.inputs },
    p_basis: basisJson,
    p_rows: plan.rows.map((row) => ({
      category: row.category,
      fiscal_year: row.fiscal_year,
      ordinal: row.ordinal,
      amount: row.amount,
      method: row.method,
      is_override: row.is_override,
    })),
    p_category_overrides: overridesJson,
  });
  if (error) throw toAppError(error);
}

/**
 * Changes a Draft's fiscal-year shape after the server matches the complete source-line witness.
 * The RPC changes only fiscal_year and budget_mode; exact source amounts and line identities stay
 * untouched, and the current editor is stamped for the activation SoD rule.
 */
export async function switchBudgetDraftMode(
  versionId: string,
  targetMode: BudgetVersionMode,
  expectedLines: readonly BudgetModeSwitchLineWitness[],
  assignments: readonly BudgetModeSwitchAssignment[],
): Promise<void> {
  const witnessJson: Json = expectedLines.map((line) => ({
    id: line.id,
    category: line.category,
    budgeted_amount: line.budgeted_amount,
    fiscal_year: line.fiscal_year,
  }));
  const assignmentJson: Json = assignments.map((assignment) => ({ ...assignment }));
  const { error } = await supabase.rpc('switch_budget_draft_mode', {
    p_version: versionId,
    p_target_mode: targetMode,
    p_expected_lines: witnessJson,
    p_assignments: assignmentJson,
  });
  if (error) throw toAppError(error);
}

/**
 * Read all visible versions and their related rows.
 *
 * ⚑ ONE bounded invoker RPC (`budget_version_read`, migration 0650) replaces the four-request graph
 * (versions, then lines ∥ editors ∥ totals) that this function used to issue. The function returns a
 * page of versions with their complete children and the 0400 total; it is security-invoker, so RLS
 * still decides every row and `org_id` is never sent.
 *
 * ⚑ Bounded by contract: the page (`p_offset`/`p_limit`) is materialised inside the function BEFORE any
 * child aggregation. When a page's children exceed the function's documented budget it returns a single
 * `overflow: true` marker and aggregates nothing — this client then discards that page and runs the
 * legacy four paged reads below for the COMPLETE project. Nothing is ever truncated, and a partial page
 * is never returned as if it were the whole budget.
 *
 * ⚑ Consistency: one call is ONE statement snapshot; a multi-page read is several. Offset paging shares
 * the legacy limitation — a version inserted or deleted before an earlier page shifts the window, so a
 * concurrent write can duplicate or skip a row. This is not a snapshot protocol.
 */
const BUDGET_READ_PAGE_SIZE = 1000;

function isOverflowMarker(row: Record<string, unknown>): boolean {
  return row.overflow === true;
}

/** Fail-closed mapping of one aggregate row. Any malformed page rejects; it never becomes empty data. */
export function mapAggregateRow(raw: unknown): BudgetVersionWithItems {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppError('Budget version read returned an unexpected row');
  }
  const row = raw as Record<string, unknown>;
  const versionRow = row.version_row;
  if (!versionRow || typeof versionRow !== 'object' || Array.isArray(versionRow)) {
    throw new AppError('Budget version read returned an unexpected version');
  }
  const version = versionRow as Record<string, unknown>;
  if (typeof version.id !== 'string' || !version.id || typeof version.project_id !== 'string') {
    throw new AppError('Budget version read returned an unexpected version');
  }
  if (typeof row.version_no !== 'number' || !Number.isInteger(row.version_no) ||
      typeof version.version !== 'number' || !Number.isInteger(version.version) ||
      row.version_id !== version.id || row.version_no !== version.version) {
    throw new AppError('Budget version read returned an inconsistent version row');
  }
  // Children are explicitly `[]`/`{}` on the wire. A missing/null child array is malformed, never "none".
  const lines = row.line_items;
  if (!Array.isArray(lines)) throw new AppError('Budget version read returned unexpected line items');
  for (const line of lines) {
    if (!line || typeof line !== 'object' || Array.isArray(line)) {
      throw new AppError('Budget version read returned an unexpected line item');
    }
    const item = line as Record<string, unknown>;
    if (typeof item.id !== 'string' || !item.id || item.budget_version_id !== version.id) {
      throw new AppError('Budget version read returned a line item from another version');
    }
  }
  const editors = row.editor_ids;
  if (!Array.isArray(editors) || editors.some((id) => typeof id !== 'string' || !id)) {
    throw new AppError('Budget version read returned unexpected editors');
  }
  const rawTotal = row.total;
  // ⚑ `Number(null)` is 0 and `Number('')` is 0: an absent total must never become money.
  if (rawTotal === null || rawTotal === undefined ||
      (typeof rawTotal !== 'number' && typeof rawTotal !== 'string') ||
      (typeof rawTotal === 'string' && rawTotal.trim() === '')) {
    throw new Error('Missing or invalid budget version total');
  }
  const total = Number(rawTotal);
  if (!Number.isFinite(total)) throw new Error('Missing or invalid budget version total');
  return {
    ...(version as unknown as BudgetVersionRow),
    line_items: lines as unknown as BudgetLineItemRow[],
    total,
    editor_ids: editors as string[],
  };
}

/** Returns `null` when the server says this page is too large to aggregate safely (caller falls back). */
async function readBudgetAggregate(projectId: string): Promise<BudgetVersionWithItems[] | null> {
  const out: BudgetVersionWithItems[] = [];
  for (let offset = 0; ; offset += BUDGET_READ_PAGE_SIZE) {
    const { data, error } = await supabase.rpc('budget_version_read', {
      p_project_id: projectId,
      p_offset: offset,
      p_limit: BUDGET_READ_PAGE_SIZE,
    });
    if (error) throw toAppError(error);
    // ⚑ NOT `data ?? []`: a null/non-array body is a broken read, not the end of the set.
    if (!Array.isArray(data)) throw new AppError('Budget version read returned an unexpected response');
    if (data.some((row) => row && typeof row === 'object' && !Array.isArray(row) && isOverflowMarker(row as Record<string, unknown>))) {
      return null;
    }
    for (const row of data) out.push(mapAggregateRow(row));
    if (data.length < BUDGET_READ_PAGE_SIZE) break;
  }
  return out;
}

/**
 * Legacy four-read path — the COMPLETE, independently paged read used for oversized pages and as the
 * rollback path. Kept byte-compatible with the pre-0650 client contract (versions ordered `version,id`,
 * lines ordered `id`, editors ordered `budget_version_id,user_id`, the 0400 totals RPC).
 */
async function listBudgetVersionsPaged(projectId: string): Promise<BudgetVersionWithItems[]> {
  const versions = await fetchAllPages((from, to) => supabase.from('budget_versions')
    .select('*').eq('project_id', projectId)
    .order('version', { ascending: true }).order('id', { ascending: true }).range(from, to));
  if (!versions.length) return [];
  const [lines, editors, totals] = await Promise.all([
    fetchAllPages((from, to) => supabase.from('budget_line_items')
      .select('*, budget_versions!inner(project_id)').eq('budget_versions.project_id', projectId)
      .order('id', { ascending: true }).range(from, to)),
    fetchAllPages((from, to) => supabase.from('budget_version_editors')
      .select('budget_version_id,user_id,budget_versions!inner(project_id)').eq('budget_versions.project_id', projectId)
      .order('budget_version_id', { ascending: true }).order('user_id', { ascending: true }).range(from, to)),
    fetchAllPages((from, to) => supabase.rpc('budget_version_read_totals', { p_project_id: projectId })
      .order('version_id', { ascending: true }).range(from, to)),
  ]);
  const linesByVersion = new Map<string, BudgetLineItemRow[]>();
  for (const { budget_versions: _parent, ...line } of lines) {
    const items = linesByVersion.get(line.budget_version_id) ?? [];
    items.push(line);
    linesByVersion.set(line.budget_version_id, items);
  }
  const editorsByVersion = new Map<string, string[]>();
  for (const editor of editors) {
    const ids = editorsByVersion.get(editor.budget_version_id) ?? [];
    ids.push(editor.user_id);
    editorsByVersion.set(editor.budget_version_id, ids);
  }
  const totalsByVersion = new Map(totals.map(row => [row.version_id, Number(row.total)]));
  return versions.map(v => {
    const total = totalsByVersion.get(v.id);
    if (total === undefined || !Number.isFinite(total)) throw new Error('Missing or invalid budget version total');
    return { ...v, line_items: linesByVersion.get(v.id) ?? [], total, editor_ids: editorsByVersion.get(v.id) ?? [] };
  });
}

/** Read all visible versions and their related rows, aggregating a normal page into one request. */
export async function listBudgetVersions(projectId: string): Promise<BudgetVersionWithItems[]> {
  const aggregated = await readBudgetAggregate(projectId);
  if (aggregated !== null) return aggregated;
  return listBudgetVersionsPaged(projectId);
}

/**
 * Reads live ERPNext v16 account budgets for a project's versions. These rows drive
 * the archive prompt and the FR-BUD-122 project banner; the archive RPC re-checks
 * the same truth under lock before persisting any cancellation intent.
 */
export async function listBudgetArchiveLiveTargets(versionIds: readonly string[]): Promise<BudgetArchiveLiveTarget[]> {
  if (versionIds.length === 0) return [];
  const { data: binding, error: bindingError } = await supabase
    .from('external_org_bindings')
    .select('version_major,activated_at')
    .eq('external_tier', 'erpnext')
    .maybeSingle();
  // A failed binding read disables the optional cancel choice, while the mirror query below still
  // powers the action-required banner and preserves the ability to archive PMO's version.
  const cancellationAvailable = !bindingError && binding?.version_major === 16 && typeof binding.activated_at === 'string';
  const data = await fetchAllPages(async (from, to) => {
    const result = await supabase
      .from('budget_push_mirror_rows')
      .select('id,budget_version_id,fiscal_year,to_fiscal_year,erp_account,erp_budget_name,erp_docstatus,erp_cancelled_at,push_state,budget_intent,activated_at_witness')
      .in('budget_version_id', [...versionIds])
      .neq('erp_account', '')
      .is('erp_cancelled_at', null)
      .order('id')
      .range(from, to);
    if (result.error) throw toAppError(result.error);
    return result;
  });
  const targets = ((data ?? []) as unknown as Array<Partial<BudgetArchiveMirrorTarget>>)
    .filter((row): row is BudgetArchiveMirrorTarget =>
      typeof row.id === 'string' &&
      typeof row.budget_version_id === 'string' &&
      typeof row.fiscal_year === 'string' &&
      (typeof row.to_fiscal_year === 'string' || row.to_fiscal_year === null) &&
      (typeof row.activated_at_witness === 'string' || row.activated_at_witness === null) &&
      typeof row.erp_account === 'string' && row.erp_account !== '' &&
      typeof row.erp_budget_name === 'string' && row.erp_budget_name !== '' &&
      row.erp_docstatus !== 2 &&
      (row.budget_intent === 'ensure' || row.budget_intent === 'remove') &&
      typeof row.push_state === 'string',
    );
  return targets.map((target) => ({ ...target, source_kind: 'account' as const, archive_cancellation_available: cancellationAvailable }));
}

/**
 * #1462 — the LEGACY (pre-v16, year-grained) twin of `listBudgetArchiveLiveTargets`.
 *
 * A v15 push writes `budget_version_erp_mirror`; a 15→16 re-bind leaves those rows in place. The
 * archived status disclosure therefore reads both account and legacy mirror kinds.
 *
 * ⚑ A null/stale activation witness is still returned: it is a reason to WARN, never a reason to hide.
 * The banner is disclosure; the archive RPC re-checks everything under lock before any write.
 */
export async function listLegacyBudgetArchiveLiveTargets(versionIds: readonly string[]): Promise<BudgetArchiveLiveTarget[]> {
  if (versionIds.length === 0) return [];
  const { data: binding, error: bindingError } = await supabase
    .from('external_org_bindings')
    .select('version_major,activated_at')
    .eq('external_tier', 'erpnext')
    .maybeSingle();
  const cancellationAvailable = !bindingError && typeof binding?.activated_at === 'string' &&
    binding?.version_major === 15;
  const data = await fetchAllPages(async (from, to) => {
    const result = await supabase
      .from('budget_version_erp_mirror')
      .select('id,budget_version_id,fiscal_year,erp_budget_name,erp_docstatus,erp_cancelled_at,push_state,activated_at_witness')
      .in('budget_version_id', [...versionIds])
      .is('erp_cancelled_at', null)
      .order('id')
      .range(from, to);
    if (result.error) throw toAppError(result.error);
    return result;
  });
  return ((data ?? []).map((row) => ({ ...row, to_fiscal_year: null })) as unknown as Array<Partial<BudgetArchiveMirrorTarget>>)
    .filter((row): row is BudgetArchiveMirrorTarget =>
      typeof row.id === 'string' &&
      typeof row.budget_version_id === 'string' &&
      typeof row.fiscal_year === 'string' &&
      typeof row.erp_budget_name === 'string' && row.erp_budget_name.trim() !== '' &&
      row.erp_docstatus !== 2 &&
      typeof row.push_state === 'string',
    )
    .map((row) => ({
      ...row,
      erp_account: '',
      to_fiscal_year: null,
      budget_intent: 'ensure' as const,
      source_kind: 'legacy' as const,
      archive_cancellation_available: cancellationAvailable,
    }));
}

/**
 * #1462 — the SERVER's conservative inventory for one version: every known potentially live ERPNext
 * Budget (both mirror kinds), the eligibility verdict and a safe reason.
 *
 * ⚑ Fails closed. A read error throws, so the surface can never render "nothing is live" out of a
 * failed query. The archive RPC re-evaluates every predicate under lock; this read is disclosure only.
 */
export async function listBudgetArchiveTargets(versionId: string): Promise<BudgetArchiveTarget[]> {
  const data = await fetchAllPages(async (from, to) => {
    const result = await supabase.rpc('get_budget_archive_targets', { p_version_id: versionId })
      .order('page_key', { ascending: true })
      .range(from, to);
    if (result.error) throw toAppError(result.error);
    if (!Array.isArray(result.data)) throw new AppError('Budget archive target read returned an unexpected response');
    return result;
  });
  if (!Array.isArray(data)) throw new AppError('Budget archive target read returned an unexpected response');
  return (data as unknown as Array<Record<string, unknown>>).map((row) => {
    if ((row.source_kind !== 'account' && row.source_kind !== 'legacy') ||
        typeof row.fiscal_year !== 'string' || typeof row.erp_budget_name !== 'string' ||
        !(typeof row.to_fiscal_year === 'string' || row.to_fiscal_year === null) ||
        (row.source_kind === 'legacy' && row.to_fiscal_year !== null) ||
        typeof row.eligible !== 'boolean' || typeof row.reason !== 'string') {
      throw new AppError('Budget archive target read returned an invalid row');
    }
    return {
      source_kind: row.source_kind,
      fiscal_year: row.fiscal_year,
      to_fiscal_year: row.to_fiscal_year,
      erp_budget_name: row.erp_budget_name,
      eligible: row.eligible,
      reason: row.reason,
      push_state: typeof row.push_state === 'string' ? row.push_state : '',
      erp_docstatus: typeof row.erp_docstatus === 'number' ? row.erp_docstatus : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Phase C — writes (line-item CRUD)
// ---------------------------------------------------------------------------

/**
 * Creates a new line-item on the given version. org_id is NEVER sent — the
 * column default + RLS `with check` stamps and verifies it (FR-BV-010).
 * The DB trigger `enforce_draft_line_item` rejects writes when the owning
 * version is not Draft (FR-BV-011 / AC-723).
 */
export async function createLineItem(
  versionId: string,
  item: NewLineItem,
  provenance?: ImportProvenance,
): Promise<BudgetLineItemRow> {
  const { data, error } = await supabase
    .from('budget_line_items')
    .insert({
      budget_version_id: versionId,
      category: item.category,
      description: item.description,
      budgeted_amount: item.budgeted_amount,
      // FR-BFY-060: omitted ⇒ the column's own NULL default (un-phased), never a synthesized year.
      fiscal_year: item.fiscal_year ?? null,
      // ⚑ `actual_amount` is DELIBERATELY absent and must stay absent (FR-BIMP-005): actuals are
      // READ from the ERP read-model, and a value written here would be a figure PMO computed
      // rather than read (ADR-0048/0055) — wrong in a way that still renders.
      ...(provenance
        ? {
            import_batch_id: provenance.importBatchId,
            imported_at: provenance.importedAt,
            import_key: provenance.importKey ?? null,
          }
        : {}),
    })
    .select()
    .single();
  if (error) throw toAppError(error);
  return data as unknown as BudgetLineItemRow;
}

/**
 * Updates an existing line-item. Throws (surfaces the DB trigger error) when
 * the owning version is not Draft (AC-723, FR-BV-006/009/011).
 * org_id is NEVER sent.
 */
export async function updateLineItem(
  id: string,
  // FR-BFY-060/061: `fiscal_year` is an ordinary line-item column here. Re-phasing an Active version
  // is rejected by `enforce_draft_line_item` (0005) — the DB is the authority, this is the seam.
  patch: Partial<Pick<BudgetLineItemRow, 'category' | 'description' | 'budgeted_amount' | 'actual_amount' | 'fiscal_year'>>,
): Promise<void> {
  const { data, error } = await supabase
    .from('budget_line_items')
    .update(patch)
    .eq('id', id)
    .select('id');
  if (error) throw toAppError(error);
  // #541: an RLS `using` denial HIDES the row rather than erroring, so the statement is a 0-row
  // no-op with `error === null`. On a money figure that is worse than a lost edit: the version can
  // then be activated and PUSHED to ERP (`dispatchFactory` reads `budget_line_items` to build the
  // Budget body) carrying the OLD amount while its author believes the new one landed.
  assertWriteLanded(data, 'Budget line item not found or you do not have permission to edit it.');
}

/**
 * Deletes a line-item by id. Throws when the owning version is not Draft
 * (DB trigger; AC-723, FR-BV-011). org_id is NEVER sent.
 */
export async function deleteLineItem(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('budget_line_items')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw toAppError(error);
  // #541: a `using`-denied DELETE removes 0 rows and reports no error — the line item, and the
  // money it carries, is still there. Fail loudly instead of toasting "Deleted".
  assertWriteLanded(data, 'Budget line item not found or you do not have permission to delete it.');
}

// ---------------------------------------------------------------------------
// Phase C — writes (version lifecycle)
// ---------------------------------------------------------------------------

const VERSION_ALLOCATION_ATTEMPTS = 4;

function isVersionAllocationConflict(error: { code?: string; message?: string }): boolean {
  return error.code === '23505' && error.message ===
    'duplicate key value violates unique constraint "budget_versions_project_id_version_key"';
}

/**
 * Creates a new Draft budget version at max(version)+1 for the project.
 * org_id is NEVER sent (AC-724, FR-BV-004).
 *
 * ⚠ #1472 FR-001: the UI names its mode EXPLICITLY (`budgetMode: 'whole_project'`) at the
 * repository boundary; the import entry names `per_year` explicitly so future default changes
 * cannot reinterpret imported history. Other mode-less callers and the CLI loader's fixed column
 * list retain the database's `'per_year'` default. A clone inherits the source mode server-side
 * (`clone_budget_version`, 0577).
 */
export async function createBudgetVersion(
  projectId: string,
  name: string,
  provenance?: ImportProvenance,
  budgetMode?: BudgetVersionMode,
): Promise<BudgetVersionRow> {
  for (let attempt = 0; attempt < VERSION_ALLOCATION_ATTEMPTS; attempt++) {
    // Step 1: read current max version for this project
    const { data: maxData, error: maxError } = await supabase
      .from('budget_versions')
      .select('version')
      .eq('project_id', projectId)
      .order('version', { ascending: false })
      .limit(1);
    if (maxError) throw new Error(maxError.message);

    const rows = (maxData ?? []) as { version: number }[];
    const nextVersion = rows.length > 0 ? rows[0].version + 1 : 1;

    // Step 2: insert new Draft at next version
    const { data, error } = await supabase
      .from('budget_versions')
      .insert({
        project_id: projectId,
        version: nextVersion,
        name,
        status: 'Draft',
        // #1472 FR-001: the UI names whole_project and import names per_year explicitly; other
        // mode-less write paths keep the database's own 'per_year' default. The CLI load path is
        // unchanged and still omits this column from its fixed allowlist.
        ...(budgetMode ? { budget_mode: budgetMode } : {}),
        // ⚑ `currency` is DELIBERATELY absent (FR-BIMP-006 / DD-BIMP-2): 0187's `stamp_currency`
        // BEFORE-INSERT trigger resolves it from `organizations.default_currency`. A client
        // hand-carrying a currency is the thing that seam exists to prevent, exactly as with org_id.
        ...(provenance
          ? {
              import_batch_id: provenance.importBatchId,
              imported_at: provenance.importedAt,
              import_key: provenance.importKey ?? null,
            }
          : {}),
      })
      .select()
      .single();
    if (error) {
      if (isVersionAllocationConflict(error) && attempt + 1 < VERSION_ALLOCATION_ATTEMPTS) continue;
      throw toAppError(error);
    }
    return data as unknown as BudgetVersionRow;
  }
  throw new Error('Version allocation attempts exhausted');
}

/**
 * Clones any version into a new Draft (via security-definer RPC that resets
 * actual_amount to 0 on all copied line-items). Returns the new version's id.
 * org_id is NEVER sent — the RPC re-asserts org from auth context (AC-725, FR-BV-007).
 */
export async function cloneVersion(versionId: string): Promise<string> {
  for (let attempt = 0; attempt < VERSION_ALLOCATION_ATTEMPTS; attempt++) {
    const { data, error } = await supabase.rpc('clone_budget_version', {
      version_id: versionId,
    });
    if (error) {
      if (isVersionAllocationConflict(error) && attempt + 1 < VERSION_ALLOCATION_ATTEMPTS) continue;
      throw toAppError(error);
    }
    return data as string;
  }
  throw new Error('Version allocation attempts exhausted');
}

/**
 * Re-reads the version's own `activated_at` witness right after `activate_budget_version` commits — the
 * RPC itself returns void, and the ADR-0059 §4 deterministic key (`budgetPushKey`) MUST be derived from
 * the SAME server-stamped value the sweep backstop will later read, never a client-side `Date.now()`
 * (a locally-minted timestamp could disagree with the DB by the width of the round trip and mint two keys
 * for the SAME activation).
 */
async function readActivatedAt(versionId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('budget_versions')
    .select('activated_at')
    .eq('id', versionId)
    .maybeSingle();
  if (error) throw toAppError(error);
  return (data as { activated_at: string | null } | null)?.activated_at ?? null;
}

/**
 * Activates a Draft version via the `activate_budget_version` security-definer RPC (atomic archive-prior
 * + activate, UNTOUCHED — ADR-0059 §3.1), then pushes the consequence into the org's ERPNext binding, if
 * any (ADR-0055 §6 / ADR-0059 Posture B). org_id NEVER sent (FR-BV-005).
 *
 * ⚑ THE MONEY INVARIANT (ADR-0059 §3.2): the push is a CONSEQUENCE, never a precondition. Every failure
 * class the push can produce — no ERPNext binding configured, ERP unreachable, an unmapped category, a
 * multi-fiscal-year project — is swallowed by `activateAndPush` into durable side-mirror state (written
 * server-side by the `adapter-dispatch` budget gate into `budget_version_erp_mirror`) and is NEVER
 * re-thrown here: this function still only throws for a REAL activation failure (the RPC's own
 * authorization/state-machine rejection), exactly as it did before P3c.
 */
export async function activateVersion(versionId: string): Promise<ActivateVersionResult> {
  // ⚑ FU-2 round 2: the dispatch's own RESPONSE is kept, because "the promise resolved" and "a push
  // happened" are not the same fact — an empty fan-out resolves 200 having sent nothing.
  // `activateAndPush` owns only the money invariant (a push failure never fails the activation), so the
  // outcome is refined here rather than teaching that module the budget response shape.
  let dispatchResult: unknown = null;
  const result = await activateAndPush({
    versionId,
    rpc: async (_fn, args) => {
      const { error } = await supabase.rpc('activate_budget_version', args as { version_id: string });
      return { error };
    },
    dispatch: async (id) => {
      dispatchResult = await pushActivatedBudget(id);
      return dispatchResult;
    },
  });
  if (!result.activated) throw toAppError(result.error);
  // The whole fan-out is the unit here (activation names no year), and only a RESOLVED dispatch can be
  // refined — a rejected one already carries its own `'failed'`.
  if (result.pushState === 'pushed') return { pushState: pushStateForYear(dispatchResult, null) };
  // ⚑ HIGH-C (Luna re-audit round 2): the push outcome is RETURNED, not discarded. Every writer of
  // `budget_version_erp_mirror` lives INSIDE `adapter-dispatch`, so a dispatch that never REACHES the
  // function (a dropped connection, the tab closed mid-request, a 502 from the platform) leaves no
  // mirror row at all — and the sweep backstop's work queue IS that mirror, so nothing ever re-drives
  // it. Discarding this made the UI show a plain success while ERPNext kept enforcing the previous
  // budget (or none) forever, with nobody notified. The durable half of the same fix is
  // `get_budget_projection`'s `'never-pushed'` state (migration 0149) + the retry below.
  return { pushState: result.pushState ?? 'failed' };
}

/**
 * HIGH-D — the operator-invokable retry for a budget push that never landed.
 *
 * The stranding it removes is certain, not hypothetical: a line in a category the Admin has not mapped
 * yet makes `runBudgetGate` reject BEFORE the outbox, so `push_state='failed'` exists with NO outbox
 * row; the sweep backstop then finds no candidate and flips it to `'held'`, which its own candidate
 * query excludes. Fixing the category map afterwards did nothing at all — and re-activating is
 * impossible (`activate_budget_version` refuses a non-Draft version). Re-dispatching under the
 * operator's OWN JWT is what makes it recoverable: it re-runs the full gate with a real, authenticated
 * actor (which is exactly what the backstop cannot synthesize — FR-BUD-102's "never finalize with a
 * NULL actor"), and derives the SAME deterministic key from `activated_at`, so a push that DID reach
 * the outbox reconciles instead of duplicating.
 *
 * NEVER re-activates: the version is already Active and its activation stamp is the key's own input.
 */
export async function retryBudgetPush(
  versionId: string,
  fiscalYear: string | null,
): Promise<ActivateVersionResult> {
  // ⚑ BFY FR-BFY-056 — a retry is a PER-YEAR act whenever there IS a year: the operator is looking at
  // one year's failed status row, and "the push failed" beside a year that actually pushed is the
  // misattribution finding 6 is about. `null` is a real, different state, not a missing argument — the
  // status RPC reports exactly one YEAR-LESS row when the Active version has no phased line and no
  // mirror row at all (nothing is on record for any year). That row's retry is the whole fan-out, and
  // withholding it there would leave the never-pushed project — the one most likely to have ERPNext
  // enforcing nothing — with no route out.
  // ⚑ H-3 (Luna audit round 3), PRESERVED across the BFY key move: the activation stamp is re-read
  // BEFORE the dispatch so an UNSTAMPED version (Active but pre-0139) refuses client-side, before any
  // request. Nothing durable is written for such a refusal — no mirror row, no notification — so
  // reporting `pushState:'failed'` would claim an attempt that never happened and hide the only
  // sentence that explains the state. The stamp is no longer used to MINT a key (the server derives
  // one per year, FR-BFY-031); it is still the fact that decides whether a push is possible at all.
  requireActivationStamp(await readActivatedAt(versionId));
  try {
    // ⚑ HIGH 5 (FR-BFY-056): the year is a real dispatch TARGET, not merely a display filter. When the
    // operator retries one year's failed row, the server dispatches ONLY that plan year — never the
    // whole fan-out (which could re-drive another year that is still recoverable or has a changed
    // blocker). A `null` year is the year-less whole-fan-out retry (the never-pushed project).
    const result = await dispatchBudgetPush(versionId, fiscalYear);
    return { pushState: pushStateForYear(result, fiscalYear) };
  } catch {
    // Same money invariant as activation: a retry whose DISPATCH fails again is reported, never thrown
    // — that durable state (mirror row + notification) is written server-side by the dispatch itself.
    //
    // ⚑ On a fan-out the served boundary answers with the FIRST failing year's status, so a rejected
    // response does not prove THIS year failed (another year's rejection could have produced it). The
    // report is therefore deliberately CONSERVATIVE — never "pushed" on a rejection — and the screen's
    // per-year truth comes from `get_budget_push_status`, which the caller re-reads on settle. A
    // pessimistic toast beside an authoritative per-year banner is safe; an optimistic one is not.
    return { pushState: 'failed' };
  }
}

/** The per-year outcomes the served fan-out reports (FR-BFY-033). Absent for a pre-BFY response. */
interface BudgetFanOutResult {
  years?: Array<{ fiscal_year: string; pushed: boolean }>;
}

/**
 * Did THIS fiscal year land? The served boundary attempts every phased year and reports each one, so a
 * partially-successful fan-out must be read per year — never collapsed into one project-wide verdict.
 * A response that names no years at all (a single-year push, or an older server) is taken at face
 * value: it resolved, so the year the operator asked about is the year that pushed.
 */
function pushStateForYear(result: unknown, fiscalYear: string | null): ActivateVersionResult['pushState'] {
  // ⚑ rm-1472 — a 202 `budget-cancellation-pending` body is NOT a push that happened. The served gate
  // parked the whole-project range's units behind an unsettled predecessor cancellation: no outbox row
  // was written, so no ERPNext Budget exists yet. The body names no `years`, so the face-value rule
  // below announced "pushed" about a project ERPNext is enforcing nothing for — while the sweep was
  // already queued to resume it. Activation stands; the push is pending.
  if ((result as { error?: unknown } | null | undefined)?.error === 'budget-cancellation-pending') return 'pending-cancellation';
  const years = (result as BudgetFanOutResult | null | undefined)?.years;
  // A pre-BFY server names no years at all — taken at face value, as before.
  if (!Array.isArray(years)) return 'pushed';
  // ⚑ FU-2 round 2: an EMPTY array is a DIFFERENT statement from an absent key. This server enumerated
  // the years it attempted and there were none (an Active version with no line items ⇒ an empty push
  // plan), so no ERP `Budget` was created and no mirror row was written. "Pushed" was a lie about money.
  if (years.length === 0) return 'nothing-to-push';
  // No year named ⇒ the operator retried a project with nothing on record for any year, so the honest
  // verdict is the WHOLE fan-out: anything less than every year landing is not "pushed".
  if (fiscalYear === null) return years.every((y) => y.pushed) ? 'pushed' : 'failed';
  const row = years.find((y) => y.fiscal_year === fiscalYear);
  return row?.pushed ? 'pushed' : 'failed';
}

/**
 * The ONE budget-push dispatch (activation consequence AND retry).
 *
 * ⚑ BFY FR-BFY-031/032 (contract change, OQ-BFY-3): the client sends the BARE `budget_version_id` and
 * NO idempotency key. Only the server can enumerate the phased fiscal years — they are validated
 * against the client's live ERPNext `Fiscal Year` doctype, a read only the server-side gate makes — so
 * only the server can derive the per-year identity `<vid>:<encoded-fy>` and key
 * `bud:<vid>:<encoded-fy>:<epoch>`. A client-minted key would key every year on one string and
 * silently suppress all but the first.
 */
function dispatchBudgetPush(versionId: string, targetFiscalYear?: string | null): Promise<unknown> {
  // ⚑ HIGH 5 (FR-BFY-056): a per-year retry names the ONE fiscal year to dispatch; the server validates
  // it against the phased plan and drives only that entry. Activation passes no year → the whole fan-out.
  const record: PmoRecord = { id: versionId, erp_doc_kind: 'budget' };
  if (targetFiscalYear) record.target_fiscal_year = targetFiscalYear;
  return dispatchDomainCommand('budget', 'create', record);
}

/** Fails closed on a version with no activation stamp — the deterministic per-year key's own input.
 *  Inventing one would key a money command on a fiction and could mint a SECOND ERP `Budget`. */
function requireActivationStamp(activatedAt: string | null): string {
  if (!activatedAt) {
    throw new AppError('budget push: the version carries no activation stamp', 'commit-rejected');
  }
  return activatedAt;
}

/** The activation-consequence push. An unstamped version is a push FAILURE, never an activation
 *  failure — `activateAndPush` swallows it into the returned push state (ADR-0059 §3.2). */
async function pushActivatedBudget(versionId: string): Promise<unknown> {
  requireActivationStamp(await readActivatedAt(versionId));
  return dispatchBudgetPush(versionId);
}

/** Archives the Active version and records the operator's v16 cancellation choice atomically. */
export async function archiveVersion(versionId: string, cancelErp: boolean): Promise<ArchiveVersionResult> {
  const { data, error } = await supabase.rpc('archive_budget_version_with_cancel_intent', {
    p_version_id: versionId,
    p_cancel_erp: cancelErp,
    p_archive_request_id: crypto.randomUUID(),
  });
  if (error) throw toAppError(error);
  const result = data as {
    cancel_erp?: unknown;
    live_target_count?: unknown;
    intent_ids?: unknown;
  } | null;
  if (!result || typeof result.cancel_erp !== 'boolean' || typeof result.live_target_count !== 'number' || !Array.isArray(result.intent_ids)) {
    throw new AppError('Budget archive returned an invalid result', 'commit-rejected');
  }
  return {
    cancelErp: result.cancel_erp,
    liveTargetCount: result.live_target_count,
    queuedCount: result.intent_ids.length,
  };
}

export async function listBudgetDocumentLinks(versionId: string): Promise<BudgetDocumentLinkRow[]> {
  return fetchAllPages(async (from, to) => {
    const result = await supabase
      .from('budget_version_document_links')
      .select('*')
      .eq('budget_version_id', versionId)
      .order('ms_linked_at')
      .order('id')
      .range(from, to);
    if (result.error) throw toAppError(result.error);
    return result;
  });
}

export async function addBudgetDocumentLink(
  versionId: string,
  reference: MicrosoftReferenceInput,
): Promise<BudgetDocumentLinkRow> {
  try {
    assertMicrosoftReference(reference);
  } catch {
    throw new AppError('Cannot link this item.', '23514', 'm365-reference-invalid');
  }
  const { data, error } = await supabase
    .from('budget_version_document_links')
    .insert({
      budget_version_id: versionId,
      ms_drive_id: reference.drive_id,
      ms_item_id: reference.item_id,
      ms_web_url: reference.web_url,
      ms_item_name: reference.name,
      ms_item_kind: reference.item_kind,
    })
    .select()
    .single();
  if (error) throw toAppError(error);
  return data as BudgetDocumentLinkRow;
}

export async function removeBudgetDocumentLink(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('budget_version_document_links')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw toAppError(error);
  assertWriteLanded(data, 'Document link not found or you do not have permission to remove it.');
}

/**
 * Hard-deletes a Draft version (cascade FK removes its line-items).
 * org_id NEVER sent — RLS gates the write.
 *
 * ⚑ This docstring used to claim "DB trigger blocks non-Draft (OD-BUDGET-C)". **That trigger did not
 * exist.** Until migration 0177 any of the four write-roles could delete the *Active* version, and
 * because `budget_line_items_budget_version_id_fkey` is `ON DELETE CASCADE` every line item went with
 * it — straight past `budget_line_items_draft_guard`, which refuses to touch a line item whose owning
 * version is not Draft. Verified live as a plain Project Manager, with zero `audit_events` rows.
 * `0177_delete_path_sod_and_project_money_sod.sql` §A1 creates the trigger the comment described:
 * a non-Draft version is now **Admin-only** to delete (ADR-0019's destructive-delete shape, which also
 * keeps an Admin's project hard-delete cascading correctly), and every delete writes a
 * `budget_version.delete` audit row. A non-Admin attempt raises 42501 naming the cascade, so the
 * `classifyMutationError` toast surfaces it — it is not a silent no-op.
 */
export async function deleteDraftVersion(versionId: string): Promise<void> {
  const { data, error } = await supabase
    .from('budget_versions')
    .delete()
    .eq('id', versionId)
    .select('id');
  if (error) throw toAppError(error);
  // #541: the 0177 trigger RAISES for a non-Admin non-Draft delete, but that is only one of the two
  // layers — an RLS `using` denial (wrong org / non-write role) still hides the row, so the delete
  // affects 0 rows and reports success. A defence-in-depth guard needs a check per layer.
  assertWriteLanded(data, 'Budget version not found or you do not have permission to delete it.');
}
