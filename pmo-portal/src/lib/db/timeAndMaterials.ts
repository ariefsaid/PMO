import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { revenueRefusalCode } from '@/src/lib/db/revenueNative';
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
export interface TmClaimSourceDetail {
  /** Row id passed to `deselect_tm_source`; `entry_id` is the underlying timesheet entry id. */
  id: string;
  entry_id: string;
  entry_date: string | null;
  person_id: string | null;
  person_name: string | null;
  /** Equipment sources name the machine; labour sources leave these null and name the person. */
  asset_id: string | null;
  asset_name: string | null;
  basis: TmClaimBasis;
  units: number;
  unit: TmRateUnit;
  line_label: string;
  is_selected: boolean;
  /** Full selected subtotal for this person (or machine) and unit, even when the visible list is capped. */
  person_unit_total: number;
}
export interface TmClaimSourcesRead extends Bounded<TmClaimSourceDetail> {
  totalCount: number;
  /** Whether the stored preparation fingerprint still matches this claim's current lines and sources. */
  signoffCurrent: boolean | null;
}

export type TmRateUnit = 'hour' | 'day';
export type TmClaimStatus = 'Draft' | 'SignedOff' | 'Withdrawn';
export type TmConfirmBasis = 'standard' | 'sole_operator';
/** A frozen claim line's source category and billing basis. */
export type TmClaimLineKind = 'labour' | 'equipment';
export type TmClaimBasis = 'work' | 'standby';

/** The line the save sends: what a person decides. The server stamps org, version, `is_current` and the author. */
export interface ContractRateLineInput {
  project_id: string;
  /** Omitted on a create; present to add a version to an existing line. */
  line_key?: string | null;
  /**
   * The save always sends kind because the RPC has no default. Equipment lines also send an asset and optional standby rate.
   */
  kind: TmClaimLineKind;
  /** Required by the server for equipment lines; absent on labour lines. */
  asset_id?: string | null;
  label: string;
  unit: TmRateUnit;
  rate: number;
  /** Optional second customer rate for equipment standby usage; absent on labour lines. */
  standby_rate?: number | null;
  /**
   * REQUIRED by the same function (`:126`): a three-letter code, refused with 23514 unless it equals `projects.currency`
   * (`:129`). Derived from the project, never typed by hand — this is the server's own currency source for the line.
   */
  currency: string;
  effective_from: string;
  effective_to?: string | null;
  /** The version the editor loaded — a mismatch is refused with 40001, never overwritten. */
  expected_version?: number | null;
  /** ERPNext Item.name for this rate line; null clears the mapping. */
  sales_item_code?: string | null;
  /** Prevents a concurrent mapping edit from overwriting the selection shown on screen. */
  expected_sales_item_code?: string | null;
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
  basis: TmClaimBasis;
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
 * The line fields belong to the matched client rate. They are NULL when no applicable line exists; an equipment
 * source still carries kind and basis so an unrated standby source remains distinguishable. `units`, `source_count`
 * and `unrated_reason` always come back.
 */
export interface TmClaimPreviewRow {
  line_key: string | null;
  rate_version: number | null;
  kind: TmClaimLineKind | null;
  basis: TmClaimBasis;
  label: string | null;
  unit: string | null;
  rate: number | null;
  user_id: string | null;
  /** An unrated equipment group names its machine; priced rows and labour rows leave these null. */
  asset_id: string | null;
  asset_name: string | null;
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
const CLAIM_LINE_KINDS: readonly TmClaimLineKind[] = ['labour', 'equipment'];
const CLAIM_BASES: readonly TmClaimBasis[] = ['work', 'standby'];

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

function parseOneRateLineResult(raw: unknown): RateLineSaveResult {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    id: str(row.id, 'rate line id'),
    lineKey: str(row.line_key, 'rate line key'),
    version: finite(row.version, 'rate line version'),
    changed: row.changed === true,
  };
}

function parseRateLineResult(raw: unknown): RateLineSaveResult | RateLineSaveResult[] {
  return Array.isArray(raw) ? raw.map(parseOneRateLineResult) : parseOneRateLineResult(raw);
}

/** Saves one rate line or an atomic batch through the existing rate-card RPC. */
export function saveContractRateLine(input: ContractRateLineInput): Promise<RateLineSaveResult>;
export function saveContractRateLine(input: ContractRateLineInput[]): Promise<RateLineSaveResult[]>;
export function saveContractRateLine(input: ContractRateLineInput | ContractRateLineInput[]): Promise<RateLineSaveResult | RateLineSaveResult[]>;
export async function saveContractRateLine(input: ContractRateLineInput | ContractRateLineInput[]): Promise<RateLineSaveResult | RateLineSaveResult[]> {
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
  return parseOneRateLineResult(data);
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

/**
 * #1817: an org with no ERP bills a confirmed claim in PMO. The new Draft invoice shares the claim's id; it is approved by
 * someone outside the claim's author set. Refusal details (e.g. `claim-already-invoiced`) become the error code.
 */
export async function invoiceTmClaimNative(claimId: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_native_tm_invoice', { p_claim: claimId });
  if (error) throw new AppError(error.message, revenueRefusalCode(error));
  if (typeof data !== 'string' || data === '') throw new AppError('the server recorded the invoice but returned no id', 'tm-malformed');
  return data;
}

// ── reads (0518) ────────────────────────────────────────────────────────────────────────────────
function parseTmClaimLine(raw: unknown): TmClaimLine {
  const line = (raw ?? {}) as Record<string, unknown>;
  return {
    lineKey: str(line.line_key, 'claim line key'),
    rateVersion: finite(line.rate_version, 'claim line rate version'),
    kind: oneOf(line.kind, CLAIM_LINE_KINDS, 'claim line kind'),
    basis: oneOf(line.basis, CLAIM_BASES, 'claim line basis'),
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
    basis: oneOf(row.basis, CLAIM_BASES, 'preview basis'),
    label: strOrNull(row.label),
    unit: strOrNull(row.unit),
    rate: finiteOrNull(row.rate, 'preview rate'),
    user_id: strOrNull(row.user_id),
    asset_id: strOrNull(row.asset_id),
    asset_name: strOrNull(row.asset_name),
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

interface ParsedTmClaimSourceDetail extends TmClaimSourceDetail {
  total_count: number;
  signoff_is_current: boolean;
}

function parseTmClaimSourceDetail(raw: unknown): ParsedTmClaimSourceDetail {
  const row = (raw ?? {}) as Record<string, unknown>;
  if (typeof row.is_selected !== 'boolean') throw new AppError('the source selection state is malformed', 'tm-malformed');
  if (typeof row.signoff_is_current !== 'boolean') throw new AppError('the sign-off freshness is malformed', 'tm-malformed');
  return {
    id: str(row.id, 'claim source row id'),
    entry_id: str(row.entry_id, 'source entry id'),
    entry_date: strOrNull(row.entry_date),
    person_id: strOrNull(row.person_id),
    person_name: strOrNull(row.person_name),
    asset_id: strOrNull(row.asset_id),
    asset_name: strOrNull(row.asset_name),
    basis: oneOf(row.basis, CLAIM_BASES, 'source basis'),
    units: finite(row.units, 'source units'),
    unit: oneOf(row.unit, ['hour', 'day'] as const, 'source unit'),
    line_label: str(row.line_label, 'source rate line'),
    is_selected: row.is_selected,
    person_unit_total: finite(row.person_unit_total, 'person source subtotal'),
    total_count: finite(row.total_count, 'source entry count'),
    signoff_is_current: row.signoff_is_current,
  };
}

/** The dated sources behind a claim's lines, through the same amounts-reader gate as the claim list (0588). */
export async function listTmClaimSources(claimId: string): Promise<TmClaimSourcesRead> {
  const { data, error } = await supabase.rpc('list_tm_claim_source_details', { p_claim: claimId })
    .limit(LIST_LIMIT + 1);
  fail(error);
  const details = ((data ?? []) as unknown[]).map(parseTmClaimSourceDetail);
  const totalCount = details[0]?.total_count ?? 0;
  const signoffCurrent = details[0]?.signoff_is_current ?? null;
  if (details.some((source) => source.total_count !== totalCount)) throw new AppError('the source-entry count is inconsistent', 'tm-malformed');
  if (details.some((source) => source.signoff_is_current !== signoffCurrent)) throw new AppError('the sign-off freshness is inconsistent', 'tm-malformed');
  const rows = details.map(({ total_count: _totalCount, signoff_is_current: _signoffCurrent, ...detail }) => detail);
  return { ...bounded(rows), totalCount, signoffCurrent };
}
