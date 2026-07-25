/**
 * erpnext/ledgerMirrorFeed.ts (task 8.6b, AC-ENA-150/162 basis) — the sweep-side feed that populates
 * `erp_gl_entry_mirror` / `erp_payment_ledger_mirror` from ERPNext `GL Entry` / `Payment Ledger Entry`
 * truth. Actuals (7.3) + the aging fallback (7.4) read the MIRROR, never live ERP (ADR-0048), so this
 * feed is what makes "mirrored ledger rows" (FR-ENA-150/162) real.
 *
 * Per mirror source: read the per-org watermark (`external_sync_watermarks`, one row per source — the
 * `modified` string); `fetchGlEntries`/`fetchPaymentLedgerEntries` (7.2) `since` that cursor; UPSERT
 * each row into the mirror on `unique(org_id, erp_name)` applying the per-row `erp_modified >=`
 * source-mod guard (an older re-fed row is a no-op — reuses the P1 FR-CUA-049 idiom); advance the
 * watermark to max `modified` (monotonic, never rewinds). Money fields cross as decimal-strings (R4).
 *
 * Pure + Deno-importable (relative imports only); the service-client seam is structural (matches
 * supabase-js at runtime, cast `as never` at the boundary — the actualsSnapshot.ts idiom). The ERP
 * client is injected (ErpClientDeps). The cancellation filter lives in `ledgerFetch.ts` (7.2) — this
 * feed forwards whatever ledgerFetch returns (single responsibility: never a second cancellation filter).
 */
import { AppError } from '../../appError.ts';
import { fetchAllRowsByKeyset } from '../../pagedRead.ts';
import { fetchGlEntries, fetchPaymentLedgerEntries, type GlEntryRow, type PaymentLedgerEntryRow } from './ledgerFetch.ts';
import type { ErpClientDeps } from './client.ts';

/** Both mirrors' uuid PRIMARY KEY (0101 §1–§2) — the KEYSET cursor + stable order the scan needs. */
const MIRROR_SCAN_ORDER = 'id';

/** Per-source watermark `domain` keys on `external_sync_watermarks` (namespaced under `ledger::`). */
export const LEDGER_GL_WM_DOMAIN = 'ledger::GL Entry';
export const LEDGER_PLE_WM_DOMAIN = 'ledger::Payment Ledger Entry';
const ERPNEXT_TIER = 'erpnext';

/** Structural service-role client seam (matches supabase-js): `.from(t).select(c).eq()...` (thenable
 *  list — awaitable for the mirror read), `.from(t).select(c).eq().eq().eq().maybeSingle()` (the
 *  watermark read), `.from(t).upsert(rows, opts?)`. Real supabase-js is not nominally assignable
 *  (thenable PostgrestFilterBuilder) — callers cast `as never` at the boundary. */
export interface LedgerFeedServiceClient {
  from(table: string): LedgerFeedTable;
}
export interface LedgerFeedTable {
  select(columns: string): LedgerFeedSelectBuilder;
  upsert(rows: unknown | unknown[], opts?: { onConflict?: string }): Promise<{ error: { message: string; code?: string } | null }>;
}
export interface LedgerFeedSelectBuilder extends PromiseLike<{ data: unknown[] | null; error: { message: string; code?: string } | null }> {
  eq(column: string, value: string | number | boolean | null): LedgerFeedSelectBuilder;
  /** The TOTAL, STABLE order the paged mirror scan needs (the mirror's uuid PK). */
  order(column: string, opts?: { ascending?: boolean }): LedgerFeedSelectBuilder;
  /** The KEYSET cursor: resume strictly AFTER the last row of the previous page. */
  gt(column: string, value: string): LedgerFeedSelectBuilder;
  /** One page's size. Without a bound PostgREST silently caps the response at `db-max-rows`. */
  limit(n: number): LedgerFeedSelectBuilder;
  maybeSingle(): Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
}

export interface FeedLedgerMirrorsOpts {
  client: ErpClientDeps;
  orgId: string;
  /** `external_org_bindings.config.company` — the ERP Company the rows are scoped to. */
  company: string;
  pageSize?: number;
}

export interface FeedLedgerMirrorsResult {
  glFed: number;
  pleFed: number;
  glCursor: string | null;
  pleCursor: string | null;
}

/**
 * Feed both ledger mirrors for one org. Reads each source's watermark, fetches since it, upserts the
 * rows with the per-row `erp_modified >=` guard, and advances each watermark to max `modified`.
 */
export async function feedLedgerMirrors(
  serviceClient: LedgerFeedServiceClient,
  opts: FeedLedgerMirrorsOpts,
): Promise<FeedLedgerMirrorsResult> {
  const { client, orgId, company, pageSize } = opts;

  const glCursor = await readWm(serviceClient, orgId, LEDGER_GL_WM_DOMAIN);
  const glRows = await fetchGlEntries(client, { company, since: glCursor ?? undefined, pageSize });
  const glFed = await upsertMirrorRows(serviceClient, 'erp_gl_entry_mirror', orgId, glRows.map(glRowToMirror));
  const glNext = maxModified(glRows);
  const glFinalCursor = await advanceWm(serviceClient, orgId, LEDGER_GL_WM_DOMAIN, glNext, glCursor);

  const pleCursor = await readWm(serviceClient, orgId, LEDGER_PLE_WM_DOMAIN);
  const pleRows = await fetchPaymentLedgerEntries(client, { company, since: pleCursor ?? undefined, pageSize });
  const pleFed = await upsertMirrorRows(serviceClient, 'erp_payment_ledger_mirror', orgId, pleRows.map(pleRowToMirror));
  const pleNext = maxModified(pleRows);
  const pleFinalCursor = await advanceWm(serviceClient, orgId, LEDGER_PLE_WM_DOMAIN, pleNext, pleCursor);

  return { glFed, pleFed, glCursor: glFinalCursor, pleCursor: pleFinalCursor };
}

async function readWm(sc: LedgerFeedServiceClient, orgId: string, domain: string): Promise<string | null> {
  const { data, error } = await sc.from('external_sync_watermarks').select('watermark_cursor')
    .eq('org_id', orgId).eq('external_tier', ERPNEXT_TIER).eq('domain', domain).maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  return (data as { watermark_cursor?: string } | null)?.watermark_cursor ?? null;
}

async function advanceWm(sc: LedgerFeedServiceClient, orgId: string, domain: string, next: string | null, prev: string | null): Promise<string | null> {
  // Monotonic: never rewind. next null (no rows this feed) keeps the prior cursor.
  const advanced = next ?? prev;
  if (advanced === null) return null;
  // Only write if it differs from prev (avoid a spurious write that could rewind via a stale prev read
  // under concurrency — the value is the max of prev and next by construction here).
  const value = prev !== null && prev > advanced ? prev : advanced;
  const { error } = await sc.from('external_sync_watermarks').upsert(
    { org_id: orgId, external_tier: ERPNEXT_TIER, domain, watermark_cursor: value },
    { onConflict: 'org_id,external_tier,domain' },
  );
  if (error) throw new AppError(error.message, error.code);
  return value;
}

/** The per-row `erp_modified >=` guarded upsert. Reads the org's existing mirror rows (PAGED), drops
 *  any fetched row whose `modified` is strictly older than the stored `erp_modified`, and batch-upserts
 *  the rest (the mirror's `unique(org_id, erp_name)` makes it an idempotent upsert-by-name).
 *
 *  ⚑ MEDIUM-1 (audit round 8): this read used to be ONE unpaged request, and its error was never
 *  checked. Both holes made the guard INERT rather than red — past PostgREST's 1000-row cap every
 *  unseen row read as "not yet mirrored" and skipped the freshness check, so a stale re-delivery
 *  could overwrite newer money; a failed read did the same for EVERY row. It now pages over the
 *  mirror's `id` PK (a total, stable order) and throws on a read error: fail CLOSED, never wave
 *  money through on a map we could not build. */
async function upsertMirrorRows(
  sc: LedgerFeedServiceClient,
  table: string,
  orgId: string,
  rows: Array<Record<string, unknown>>,
): Promise<number> {
  if (rows.length === 0) return 0;
  // Read existing erp_modified per erp_name for the per-row guard (one batched read).
  const existing = new Map<string, string>();
  type MirrorKeyRow = { id: string; erp_name?: string; erp_modified?: string };
  const mirrored = await fetchAllRowsByKeyset<MirrorKeyRow>((afterId, limit) => {
    const q = sc.from(table).select('id,erp_name,erp_modified').eq('org_id', orgId)
      .order(MIRROR_SCAN_ORDER, { ascending: true });
    return (afterId === null ? q : q.gt(MIRROR_SCAN_ORDER, afterId))
      .limit(limit) as PromiseLike<{ data: MirrorKeyRow[] | null; error: { message: string; code?: string } | null }>;
  });
  for (const r of mirrored) {
    if (r.erp_name) existing.set(String(r.erp_name), String(r.erp_modified ?? ''));
  }
  const fresh = rows.filter((r) => {
    const name = String(r.erp_name);
    const stored = existing.get(name);
    if (stored === undefined) return true; // not yet mirrored
    return String(r.erp_modified) >= stored; // >= : re-delivery of the same modified re-applies (idempotent)
  });
  if (fresh.length === 0) return 0;
  const { error } = await sc.from(table).upsert(fresh.map((r) => ({ ...r, org_id: orgId })));
  if (error) throw new AppError(error.message, error.code);
  return fresh.length;
}

function maxModified(rows: Array<{ modified: string }>): string | null {
  let max: string | null = null;
  for (const r of rows) if (max === null || r.modified > max) max = r.modified;
  return max;
}

function glRowToMirror(r: GlEntryRow): Record<string, unknown> {
  return {
    erp_name: r.name,
    account: r.account,
    cost_center: r.cost_center,
    fiscal_year: r.fiscal_year,
    project: r.project,
    party_type: r.party_type,
    party: r.party,
    voucher_type: r.voucher_type,
    voucher_no: r.voucher_no,
    posting_date: r.posting_date,
    debit: r.debit,
    credit: r.credit,
    is_cancelled: r.is_cancelled,
    erp_docstatus: r.docstatus,
    erp_modified: r.modified,
  };
}

function pleRowToMirror(r: PaymentLedgerEntryRow): Record<string, unknown> {
  return {
    erp_name: r.name,
    account: r.account,
    party_type: r.party_type,
    party: r.party,
    against_voucher_type: r.against_voucher_type,
    against_voucher_no: r.against_voucher_no,
    amount: r.amount,
    posting_date: r.posting_date,
    due_date: r.due_date,
    erp_docstatus: r.docstatus,
    erp_modified: r.modified,
  };
}
