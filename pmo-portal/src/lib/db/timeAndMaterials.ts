import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Json, Tables } from '@/src/lib/supabase/database.types';

/**
 * Time-and-materials DAL (#1514 T7, plan 2026-11-02-time-and-materials-claims.md).
 *
 * T&M is a source of CLAIM LINES, not a second billing path: the rate card (0515), assembly (0516), sign-off (0517)
 * and the two reads (0518) are all security-definer RPCs, so every write here is an RPC call and `org_id`, an author,
 * a status or a version stamp never leaves the client. The RPCs — not this module — decide who may see an amount, and
 * a refused call keeps its Postgres code (42501 not-permitted/SoD, 22023 bad input, 23514 shape, 23505 duplicate,
 * 40001 stale version, P0001 illegal state, P0002 not found) so the screen can name the remedy.
 *
 * Reads are bounded at `LIST_LIMIT + 1` and report `truncated`, so a silently trimmed read can never be mistaken for
 * the whole set (money-path primer bucket 5). Money and quantities are parsed strictly: a malformed response is an
 * error, never a zero (bucket 5 again — a fabricated 0.00 on a claim total is a wrong number on screen).
 */
export type ContractRateLineRow = Tables<'contract_rate_lines'>;
export type ContractRateAssigneeRow = Tables<'contract_rate_assignees'>;
export type TmClaimSourceRow = Tables<'tm_claim_sources'>;

export const LIST_LIMIT = 200;
export interface Bounded<T> { rows: T[]; truncated: boolean }

export type TmRateUnit = 'hour' | 'day';
export type TmClaimStatus = 'Draft' | 'SignedOff' | 'Withdrawn';
export type TmConfirmBasis = 'standard' | 'sole_operator';
/**
 * A claim line's kind — 0516 `tm_claim_lines.kind check (kind in ('labour'))`. T5 (equipment usage) widens the server
 * check and this union together; until then the column has exactly one member, so the screen can switch on it.
 */
export type TmClaimLineKind = 'labour';

/** The line the save sends: what a person decides. The server stamps org, version, `is_current` and the author. */
export interface ContractRateLineInput {
  project_id: string;
  /** Omitted on a create; present to add a version to an existing line. */
  line_key?: string | null;
  /**
   * REQUIRED by 0515 `contract_rate_line_normalize` (`:114`: anything but `labour` is 22023) — the save always sends it,
   * because a form cannot know to and the RPC has no default.
   */
  kind: TmClaimLineKind;
  label: string;
  unit: TmRateUnit;
  rate: number;
  /**
   * REQUIRED by the same function (`:126`): a three-letter code, refused with 23514 unless it equals `projects.currency`
   * (`:129`). Derived from the project, never typed by hand — this is the server's own currency source for the line.
   */
  currency: string;
  effective_from: string;
  effective_to?: string | null;
  /** The version the editor loaded — a mismatch is refused with 40001, never overwritten. */
  expected_version?: number | null;
}

export interface RateLineSaveResult {
  id: string;
  lineKey: string;
  version: number;
  changed: boolean;
}

export interface EndRateLineInput {
  projectId: string;
  lineKey: string;
  effectiveTo: string;
  expectedVersion: number;
}

export interface RateAssigneeInput {
  projectId: string;
  lineKey: string;
  userId: string;
  from: string;
  to: string | null;
}

export interface EndRateAssigneeInput {
  projectId: string;
  /** The assignment ROW id (the RPC takes the row, not the person). */
  assigneeId: string;
  effectiveTo: string;
}

export interface AssembleTmClaimInput {
  projectId: string;
  from: string;
  to: string;
  workOrderId?: string | null;
  /** Source ids the preparer did not select; omitted rather than sent empty. */
  exclude?: string[];
}

export interface PrepareTmSignoffInput {
  claimId: string;
  documentId: string;
  note?: string | null;
}

export interface TmConfirmResult {
  claimId: string;
  basis: TmConfirmBasis;
  grossAmount: number;
}

/** One frozen claim line (§D3): rate, unit, label and version are copied at assembly and never re-derived. */
export interface TmClaimLine {
  lineKey: string;
  rateVersion: number;
  kind: TmClaimLineKind;
  label: string;
  unit: string;
  units: number;
  rate: number;
  amount: number;
}

/** `list_tm_claims` header + its frozen lines. The header mirrors the `tm_claims` row, so it stays snake_case. */
export interface TmClaimSummary {
  id: string;
  work_order_id: string | null;
  period_from: string;
  period_to: string;
  status: TmClaimStatus;
  currency: string;
  gross_amount: number;
  prepared_by: string;
  signoff_prepared_by: string | null;
  confirmed_by: string | null;
  confirm_basis: TmConfirmBasis | null;
  document_id: string | null;
  note: string | null;
  created_at: string;
  lines: TmClaimLine[];
}

/**
 * One `preview_tm_claim` row: a priced line, or an UNRATED group (no amount, and a reason — never a guessed rate).
 * The line fields (`kind`/`label`/`unit`) belong to the LINE, so they are NULL on an unrated group: 0516's lateral join
 * finds no rate row for `no_assignee`/`no_rate`, and only `unit_not_supported` carries a line. `units`, `source_count`
 * and `unrated_reason` always come back.
 */
export interface TmClaimPreviewRow {
  line_key: string | null;
  rate_version: number | null;
  kind: TmClaimLineKind | null;
  label: string | null;
  unit: string | null;
  rate: number | null;
  user_id: string | null;
  units: number;
  amount: number | null;
  source_count: number;
  unrated_reason: string | null;
}

export interface TmClaimPreviewInput {
  projectId: string;
  from: string;
  to: string;
}

const bounded = <T>(rows: T[] | null): Bounded<T> =>
  ({ rows: (rows ?? []).slice(0, LIST_LIMIT), truncated: (rows ?? []).length > LIST_LIMIT });

const fail = (error: { message: string; code?: string } | null): void => {
  if (error) throw new AppError(error.message, error.code);
};

/** A required finite number; a missing, blank or non-finite value is an error, never zero. */
function finite(value: unknown, what: string): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) throw new AppError(`the response has a malformed ${what}`, 'tm-malformed');
  return parsed;
}

/** An optional finite number: `null`/absent stays `null` (an unrated group has no amount — it is not 0.00). */
function finiteOrNull(value: unknown, what: string): number | null {
  if (value === null || value === undefined) return null;
  return finite(value, what);
}

function str(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') throw new AppError(`the response has a malformed ${what}`, 'tm-malformed');
  return value;
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

const CLAIM_STATUSES: readonly TmClaimStatus[] = ['Draft', 'SignedOff', 'Withdrawn'];
const CONFIRM_BASES: readonly TmConfirmBasis[] = ['standard', 'sole_operator'];
const CLAIM_LINE_KINDS: readonly TmClaimLineKind[] = ['labour'];

/** A closed server enum, or an error: an unmapped status must never fall through a screen's switch as "no status". */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new AppError(`the response has a malformed ${what}`, 'tm-malformed');
  }
  return value as T;
}

// ── the rate card (0515) ─────────────────────────────────────────────────────────────────────────
/** Current lines by default; `includeHistory` adds the superseded versions (the panel's history toggle). */
export async function listRateLines(
  projectId: string,
  opts: { includeHistory?: boolean } = {},
): Promise<Bounded<ContractRateLineRow>> {
  let query = supabase.from('contract_rate_lines').select('*').eq('project_id', projectId);
  if (!opts.includeHistory) query = query.eq('is_current', true);
  const { data, error } = await query
    .order('label', { ascending: true })
    .order('effective_from', { ascending: false })
    .order('id', { ascending: true })
    .limit(LIST_LIMIT + 1);
  fail(error);
  return bounded(data);
}

export async function listRateAssignees(projectId: string): Promise<Bounded<ContractRateAssigneeRow>> {
  const { data, error } = await supabase.from('contract_rate_assignees').select('*')
    .eq('project_id', projectId)
    .order('effective_from', { ascending: false })
    .order('id', { ascending: true })
    .limit(LIST_LIMIT + 1);
  fail(error);
  return bounded(data);
}

function parseRateLineResult(raw: unknown): RateLineSaveResult {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    id: str(row.id, 'rate line id'),
    lineKey: str(row.line_key, 'rate line key'),
    version: finite(row.version, 'rate line version'),
    changed: row.changed === true,
  };
}

/** Creates a line, or adds a version to it; an unchanged body returns `changed: false` with no new version. */
export async function saveContractRateLine(input: ContractRateLineInput): Promise<RateLineSaveResult> {
  const { data, error } = await supabase.rpc('save_contract_rate_line', { p_line: input as unknown as Json });
  fail(error);
  return parseRateLineResult(data);
}

export async function endContractRateLine(input: EndRateLineInput): Promise<RateLineSaveResult> {
  const { data, error } = await supabase.rpc('end_contract_rate_line', {
    p_project: input.projectId,
    p_line_key: input.lineKey,
    p_effective_to: input.effectiveTo,
    p_expected_version: input.expectedVersion,
  });
  fail(error);
  return parseRateLineResult(data);
}

/** Assigns a person to a labour line for a window; refuses an overlap for that person with 23505. */
export async function setContractRateAssignee(input: RateAssigneeInput): Promise<string> {
  const { data, error } = await supabase.rpc('set_contract_rate_assignee', {
    p_project: input.projectId,
    p_line_key: input.lineKey,
    p_user: input.userId,
    p_from: input.from,
    // Open-ended is a real value the SQL accepts as null; the generated type says `string` (as elsewhere, e.g.
    // `import_budget_line_v2`'s p_fiscal_year), so the null is cast rather than dropped — omitting it would make
    // PostgREST fall back to the default instead of the caller's intent.
    p_to: (input.to ?? null) as string,
  });
  fail(error);
  if (typeof data !== 'string' || data === '') throw new AppError('the assignment was not created', 'tm-malformed');
  return data;
}

export async function endContractRateAssignee(input: EndRateAssigneeInput): Promise<void> {
  const { error } = await supabase.rpc('end_contract_rate_assignee', {
    p_project: input.projectId,
    p_assignee: input.assigneeId,
    p_effective_to: input.effectiveTo,
  });
  fail(error);
}

// ── assembly (0516) ─────────────────────────────────────────────────────────────────────────────
/** Freezes a Draft claim from the approved, rated hours in the range; returns its id. */
export async function assembleTmClaim(input: AssembleTmClaimInput): Promise<string> {
  const { data, error } = await supabase.rpc('assemble_tm_claim', {
    p_project: input.projectId,
    p_from: input.from,
    p_to: input.to,
    ...(input.workOrderId ? { p_work_order: input.workOrderId } : {}),
    ...(input.exclude && input.exclude.length > 0 ? { p_exclude: input.exclude as unknown as Json } : {}),
  });
  fail(error);
  if (typeof data !== 'string' || data === '') throw new AppError('the claim was not assembled', 'tm-malformed');
  return data;
}

/**
 * Removes one source from a Draft claim (the claim total and the line are recomputed server-side).
 *
 * `claimSourceId` is the `tm_claim_sources` ROW (`deselect_tm_source` matches `s.id = p_source`, 0516:253) — NOT that
 * row's `source_id`, which is the timesheet entry / equipment usage it points at (0516:159 reads `p_exclude` as the
 * entry id, a different id space in the same module).
 */
export async function deselectTmSource(claimId: string, claimSourceId: string): Promise<void> {
  const { error } = await supabase.rpc('deselect_tm_source', { p_claim: claimId, p_source: claimSourceId });
  fail(error);
}

// ── sign-off (0517) ─────────────────────────────────────────────────────────────────────────────
/** Attaches the signed project document and fingerprints the claim; the confirmer must differ (FR-TM-022). */
export async function prepareTmSignoff(input: PrepareTmSignoffInput): Promise<void> {
  const note = input.note?.trim();
  const { error } = await supabase.rpc('prepare_tm_signoff', {
    p_claim: input.claimId,
    p_document: input.documentId,
    ...(note ? { p_note: note } : {}),
  });
  fail(error);
}

/** A Draft claim may be withdrawn (releasing its sources); a confirmed one only through its invoice's cancel path. */
export async function withdrawTmSignoff(claimId: string): Promise<void> {
  const { error } = await supabase.rpc('withdraw_tm_signoff', { p_claim: claimId });
  fail(error);
}

/** Confirms the client sign-off: creates the claim record and its evidence in one transaction. */
export async function confirmTmSignoff(claimId: string): Promise<TmConfirmResult> {
  const { data, error } = await supabase.rpc('confirm_tm_signoff', { p_claim: claimId });
  fail(error);
  const raw = (data ?? null) as Record<string, unknown> | null;
  if (typeof raw !== 'object' || raw === null) throw new AppError('the confirmation response is malformed', 'tm-malformed');
  return {
    claimId: str(raw.claim_id, 'claim id'),
    basis: oneOf(raw.basis, CONFIRM_BASES, 'confirmation basis'),
    grossAmount: finite(raw.gross_amount, 'claim gross amount'),
  };
}

// ── reads (0518) ────────────────────────────────────────────────────────────────────────────────
function parseTmClaimLine(raw: unknown): TmClaimLine {
  const line = (raw ?? {}) as Record<string, unknown>;
  return {
    lineKey: str(line.line_key, 'claim line key'),
    rateVersion: finite(line.rate_version, 'claim line rate version'),
    kind: oneOf(line.kind, CLAIM_LINE_KINDS, 'claim line kind'),
    label: str(line.label, 'claim line label'),
    unit: str(line.unit, 'claim line unit'),
    units: finite(line.units, 'claim line units'),
    rate: finite(line.rate, 'claim line rate'),
    amount: finite(line.amount, 'claim line amount'),
  };
}

/** A claim whose `lines` payload cannot be read is an ERROR: a claim rendered with no lines reads as a zero claim. */
function parseTmClaimRow(raw: unknown): TmClaimSummary {
  const row = (raw ?? {}) as Record<string, unknown>;
  if (!Array.isArray(row.lines)) throw new AppError('the claim response has malformed lines', 'tm-malformed');
  return {
    id: str(row.id, 'claim id'),
    work_order_id: strOrNull(row.work_order_id),
    period_from: str(row.period_from, 'claim period start'),
    period_to: str(row.period_to, 'claim period end'),
    status: oneOf(row.status, CLAIM_STATUSES, 'claim status'),
    currency: str(row.currency, 'claim currency'),
    gross_amount: finite(row.gross_amount, 'claim gross amount'),
    prepared_by: str(row.prepared_by, 'claim preparer'),
    signoff_prepared_by: strOrNull(row.signoff_prepared_by),
    confirmed_by: strOrNull(row.confirmed_by),
    confirm_basis: row.confirm_basis === null || row.confirm_basis === undefined
      ? null
      : oneOf(row.confirm_basis, CONFIRM_BASES, 'claim confirm basis'),
    document_id: strOrNull(row.document_id),
    note: strOrNull(row.note),
    created_at: str(row.created_at, 'claim creation time'),
    lines: row.lines.map(parseTmClaimLine),
  };
}

/** A project's claims with their frozen lines, newest first (the amounts audience only — 0518 gates it). */
export async function listTmClaims(projectId: string): Promise<Bounded<TmClaimSummary>> {
  const { data, error } = await supabase.rpc('list_tm_claims', { p_project: projectId });
  fail(error);
  return bounded(((data ?? []) as unknown[]).map(parseTmClaimRow));
}

function parsePreviewRow(raw: unknown): TmClaimPreviewRow {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    line_key: strOrNull(row.line_key),
    rate_version: finiteOrNull(row.rate_version, 'preview rate version'),
    // The line's own fields: NULL by construction on an unrated group (0516's lateral join found no rate row), so a
    // row without them is the RPC's normal shape, not a malformed response.
    kind: row.kind === null || row.kind === undefined ? null : oneOf(row.kind, CLAIM_LINE_KINDS, 'preview kind'),
    label: strOrNull(row.label),
    unit: strOrNull(row.unit),
    rate: finiteOrNull(row.rate, 'preview rate'),
    user_id: strOrNull(row.user_id),
    units: finite(row.units, 'preview units'),
    // An unrated group has NO amount: it must never read as 0.00 in the review list.
    amount: finiteOrNull(row.amount, 'preview amount'),
    source_count: finite(row.source_count, 'preview source count'),
    unrated_reason: strOrNull(row.unrated_reason),
  };
}

/** What the range would claim, priced, plus the unrated groups and why — writes nothing (FR-TM-010/011). */
export async function previewTmClaim(input: TmClaimPreviewInput): Promise<Bounded<TmClaimPreviewRow>> {
  const { data, error } = await supabase.rpc('preview_tm_claim', {
    p_project: input.projectId,
    p_from: input.from,
    p_to: input.to,
  });
  fail(error);
  return bounded(((data ?? []) as unknown[]).map(parsePreviewRow));
}

/** The sources behind a claim's lines — the detail drill-down (RLS-visible exactly when the claim is). */
export async function listTmClaimSources(claimId: string): Promise<Bounded<TmClaimSourceRow>> {
  const { data, error } = await supabase.from('tm_claim_sources').select('*')
    .eq('claim_id', claimId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(LIST_LIMIT + 1);
  fail(error);
  return bounded(data);
}
