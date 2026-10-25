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
 * client is injected (ErpClientDeps).
 *
 * #901 — cancellation is a FLAG, never a filter. ledgerFetch returns cancelled rows (`is_cancelled` /
 * `delinked`); this feed writes the flag onto the mirror copy IN PLACE, keyed on the mirror's unique
 * `(org_id, erp_name)`, and the readers (actuals, the aging fallback) exclude flagged rows. The upsert
 * MUST name that key: without `onConflict` PostgREST targets the uuid PK the rows never carry, so every
 * re-delivered name (the `>=` cursor re-delivers the boundary row on every tick; a cancel re-delivers the
 * originals) is a 23505 that fails the whole batch before the watermark advances — freezing the mirror.
 *
 * Reposted vouchers (2026-10-25). ERPNext's "Repost Accounting Ledger" re-creates a voucher's ledger rows
 * and can HARD-DELETE the previous ones (no Deleted Document, nothing for a modified cursor to see). An
 * upsert-by-name alone therefore leaves the deleted rows live and the voucher counts twice. So when a
 * fetched batch touches a voucher whose mirror copy holds rows the batch did not re-deliver, the feed
 * reads ERPNext's CURRENT full row set for that voucher and replaces the mirror's copy in ONE RPC
 * (`replace_erp_{gl,ple}_voucher_rows`, 0382): upsert + delete-absent in one transaction. All voucher
 * reads finish before any write; a failed read throws before any write, and a voucher too big to read in
 * full is skipped and reported — a partial read can never remove a row. At most VOUCHER_REPLACES_PER_TICK
 * vouchers are read per tick; the cursor holds at the first one not reached. Absent rows are DELETED, not flagged: the mirror mirrors ERPNext, which
 * no longer has them, and it is the convention the complete statement replay already uses (0312).
 */
import { AppError } from '../../appError.ts';
import { fetchAllRowsByKeyset } from '../../pagedRead.ts';
import { fetchGlEntries, fetchPaymentLedgerEntries, type GlEntryRow, type LedgerFetchResult, type PaymentLedgerEntryRow } from './ledgerFetch.ts';
import type { ErpClientDeps } from './client.ts';

/** Both mirrors' uuid PRIMARY KEY (0101 §1–§2) — the KEYSET cursor + stable order the scan needs. */
const MIRROR_SCAN_ORDER = 'id';
/** Both mirrors' natural key — `unique (org_id, erp_name)` (0101 §1–§2): the upsert's conflict target. */
const MIRROR_UNIQUE_KEY = 'org_id,erp_name';

/** Per-source watermark `domain` keys on `external_sync_watermarks` (namespaced under `ledger::`). */
export const LEDGER_GL_WM_DOMAIN = 'ledger::GL Entry';
export const LEDGER_PLE_WM_DOMAIN = 'ledger::Payment Ledger Entry';
/** A one-off repair marker (`<domain>::repair`, written by a migration — 0382): the feed re-reads from
 *  it, independently of the ordinary cursor, and deletes it once caught up. Code that predates the
 *  marker never reads it, so a tick of old code cannot consume the repair. */
export const repairWmDomain = (domain: string): string => `${domain}::repair`;
const ERPNEXT_TIER = 'erpnext';

/** Structural service-role client seam (matches supabase-js): `.from(t).select(c).eq()...` (thenable
 *  list — awaitable for the mirror read), `.from(t).select(c).eq().eq().eq().maybeSingle()` (the
 *  watermark read), `.from(t).upsert(rows, opts?)`. Real supabase-js is not nominally assignable
 *  (thenable PostgrestFilterBuilder) — callers cast `as never` at the boundary. */
export interface LedgerFeedServiceClient {
  from(table: string): LedgerFeedTable;
  /** `finish_erp_gl_replay` (0312) and `replace_erp_{gl,ple}_voucher_rows` (0382). */
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
}
export interface LedgerFeedTable {
  select(columns: string): LedgerFeedSelectBuilder;
  update(values: Record<string, unknown>, opts?: { count?: 'exact' }): LedgerFeedUpdateBuilder;
  upsert(rows: unknown | unknown[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }): Promise<{ error: { message: string; code?: string } | null }>;
  delete(): LedgerFeedDeleteBuilder;
}
export interface LedgerFeedDeleteBuilder extends PromiseLike<{ error: { message: string; code?: string } | null }> {
  eq(column: string, value: string | number | boolean | null): LedgerFeedDeleteBuilder;
}
export interface LedgerFeedUpdateBuilder extends PromiseLike<{ count: number | null; error: { message: string; code?: string } | null }> {
  eq(column: string, value: string | number | boolean | null): LedgerFeedUpdateBuilder;
  lt(column: string, value: string): LedgerFeedUpdateBuilder;
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
  /** Test/operations override; production defaults to the bounded ledger-fetch budget. */
  maxPages?: number;
  /** Full historical statement replay: fetch all GL pages and fail closed before any mirror/watermark write if incomplete. */
  fullReplay?: boolean;
}

export interface FeedLedgerMirrorsResult {
  glFed: number;
  pleFed: number;
  glCursor: string | null;
  pleCursor: string | null;
  glCaughtUp: boolean;
  pleCaughtUp: boolean;
  /** Vouchers whose current set was too big to read in full this tick: their rows were upserted but
   *  nothing was removed. `<doctype> <voucher type> <voucher no>`; surfaced as a ledger error. */
  skippedVouchers: string[];
}

/**
 * Feed both ledger mirrors for one org. Reads each source's watermark, fetches since it, upserts the
 * rows with the per-row `erp_modified >=` guard, and advances each watermark to max `modified`.
 */
export async function feedLedgerMirrors(
  serviceClient: LedgerFeedServiceClient,
  opts: FeedLedgerMirrorsOpts,
): Promise<FeedLedgerMirrorsResult> {
  const { client, orgId, company, pageSize, maxPages, fullReplay = false } = opts;

  const glCursor = await readWm(serviceClient, orgId, LEDGER_GL_WM_DOMAIN);
  const glRepair = fullReplay ? null : await readWm(serviceClient, orgId, repairWmDomain(LEDGER_GL_WM_DOMAIN));
  // A caller-supplied small budget is used to exercise/limit the initial backfill. Resumed ticks use
  // the production default budget so the inclusive boundary row does not consume an entire override
  // budget before the next unseen page can be observed; production remains bounded on every tick.
  const glResult = await fetchGlEntries(client, {
    company,
    since: fullReplay ? undefined : earlierCursor(glCursor, glRepair) ?? undefined,
    pageSize,
    maxPages: fullReplay ? (maxPages ?? 300) : maxPages,
  });
  if (fullReplay && !glResult.caughtUp) throw new AppError('Full statement replay page budget exhausted; mirror and watermark were not changed', 'external-unreachable');
  const replayId = fullReplay ? crypto.randomUUID() : null;
  const glRows = glResult.rows.map((row) => ({ ...glRowToMirror(row), ...(replayId ? { replay_seen_id: replayId } : {}) }));
  const gl = await upsertMirrorRows(serviceClient, GL_LEDGER, orgId, company, glRows, fullReplay ? null
    : async (voucher) => {
      const r = await fetchGlEntries(client, { company, voucher, maxPages: VOUCHER_MAX_PAGES });
      return { caughtUp: r.caughtUp, rows: r.rows.map(glRowToMirror) };
    });
  const glFed = gl.fed;
  // Held at the first voucher not yet replaced (the per-tick budget ran out): the next tick re-reads from it.
  const glNext = gl.holdAt ?? maxModified(glResult.rows);
  const glCaughtUp = glResult.caughtUp && gl.holdAt === null;
  let glFinalCursor: string | null;
  if (fullReplay) {
    const { data, error } = await serviceClient.rpc('finish_erp_gl_replay', {
      p_org_id: orgId, p_company: company, p_replay_id: replayId!, p_watermark: glNext,
    });
    if (error) throw new AppError(error.message, error.code);
    if ((data as { stale_binding?: unknown } | null)?.stale_binding === true) {
      throw new AppError('Full statement replay refused: stale binding changed during replay', 'config-rejected');
    }
    glFinalCursor = glNext;
  } else {
    glFinalCursor = await advanceWm(serviceClient, orgId, LEDGER_GL_WM_DOMAIN, glNext, glCursor);
    await settleRepair(serviceClient, orgId, LEDGER_GL_WM_DOMAIN, glRepair, glNext, glCaughtUp);
  }

  const pleCursor = await readWm(serviceClient, orgId, LEDGER_PLE_WM_DOMAIN);
  const pleRepair = await readWm(serviceClient, orgId, repairWmDomain(LEDGER_PLE_WM_DOMAIN));
  const pleResult = await fetchPaymentLedgerEntries(client, {
    company,
    since: earlierCursor(pleCursor, pleRepair) ?? undefined,
    pageSize,
    maxPages,
  });
  const ple = await upsertMirrorRows(serviceClient, PLE_LEDGER, orgId, company, pleResult.rows.map(pleRowToMirror),
    async (voucher) => {
      const r = await fetchPaymentLedgerEntries(client, { company, voucher, maxPages: VOUCHER_MAX_PAGES });
      return { caughtUp: r.caughtUp, rows: r.rows.map(pleRowToMirror) };
    });
  const pleNext = ple.holdAt ?? maxModified(pleResult.rows);
  const pleCaughtUp = pleResult.caughtUp && ple.holdAt === null;
  const pleFinalCursor = await advanceWm(serviceClient, orgId, LEDGER_PLE_WM_DOMAIN, pleNext, pleCursor);
  if (pleRepair !== null && pleCaughtUp) {
    // The full PLE re-read is complete: every row ERPNext still has now carries its voucher, so a row
    // still without one was never re-delivered and no longer exists. Retire those and the marker together.
    const { data, error } = await serviceClient.rpc('finish_erp_ple_voucher_backfill', { p_org_id: orgId, p_company: company });
    if (error) throw new AppError(error.message, error.code);
    if ((data as { stale_binding?: unknown } | null)?.stale_binding === true) {
      throw new AppError('Payment Ledger backfill finish refused: stale binding changed during the feed', 'config-rejected');
    }
  } else {
    await settleRepair(serviceClient, orgId, LEDGER_PLE_WM_DOMAIN, pleRepair, pleNext, pleCaughtUp);
  }

  return {
    glFed,
    pleFed: ple.fed,
    glCursor: glFinalCursor,
    pleCursor: pleFinalCursor,
    glCaughtUp,
    pleCaughtUp,
    skippedVouchers: [...gl.skipped.map((v) => `GL Entry ${v}`), ...ple.skipped.map((v) => `Payment Ledger Entry ${v}`)],
  };
}

/** The read start: the repair marker when it is behind the cursor. No cursor already means a full read. */
function earlierCursor(cursor: string | null, repair: string | null): string | null {
  return cursor !== null && repair !== null && repair < cursor ? repair : cursor;
}

/** After a successful read: a caught-up repair is done (marker deleted); a budget-bounded one resumes
 *  from what it read. A failed tick never gets here, so the marker survives it. */
async function settleRepair(sc: Pick<LedgerFeedServiceClient, 'from'>, orgId: string, domain: string, repair: string | null, next: string | null, caughtUp: boolean): Promise<void> {
  if (repair === null) return;
  const repairDomain = repairWmDomain(domain);
  if (!caughtUp) {
    await advanceWm(sc, orgId, repairDomain, next, repair);
    return;
  }
  const { error } = await sc.from('external_sync_watermarks').delete()
    .eq('org_id', orgId).eq('external_tier', ERPNEXT_TIER).eq('domain', repairDomain);
  if (error) throw new AppError(error.message, error.code);
}

export async function readWm(sc: Pick<LedgerFeedServiceClient, 'from'>, orgId: string, domain: string): Promise<string | null> {
  const { data, error } = await sc.from('external_sync_watermarks').select('watermark_cursor')
    .eq('org_id', orgId).eq('external_tier', ERPNEXT_TIER).eq('domain', domain).maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  return (data as { watermark_cursor?: string } | null)?.watermark_cursor ?? null;
}

export async function advanceWm(sc: Pick<LedgerFeedServiceClient, 'from'>, orgId: string, domain: string, next: string | null, prev: string | null): Promise<string | null> {
  // Monotonic: never rewind. next null (no rows this feed) keeps the prior cursor.
  const value = next === null ? prev : prev !== null && prev > next ? prev : next;
  if (value === null) return null;

  // A read-then-upsert is racy: another tick can advance the row after `prev` was read, then this
  // tick's ordinary upsert would rewind it. Update only a row that is still strictly behind value.
  const table = sc.from('external_sync_watermarks');
  const { count, error: updateError } = await table.update(
    { watermark_cursor: value },
    { count: 'exact' },
  ).eq('org_id', orgId).eq('external_tier', ERPNEXT_TIER).eq('domain', domain)
    .lt('watermark_cursor', value);
  if (updateError) throw new AppError(updateError.message, updateError.code);

  // If no row matched, it is either already at/ahead of value or absent. Insert-if-absent handles
  // first activation without overwriting a concurrent winner; the final read reports the stored truth.
  if (count === 0) {
    const { error: insertError } = await sc.from('external_sync_watermarks').upsert(
      { org_id: orgId, external_tier: ERPNEXT_TIER, domain, watermark_cursor: value },
      { onConflict: 'org_id,external_tier,domain', ignoreDuplicates: true },
    );
    if (insertError) throw new AppError(insertError.message, insertError.code);
  }
  return readWm(sc, orgId, domain);
}

/** One voucher's identity — the key ERPNext reposts a voucher's ledger rows under. */
type Voucher = { type: string; no: string };
type VoucherRead = (voucher: Voucher) => Promise<LedgerFetchResult<Record<string, unknown>>>;

interface LedgerTable {
  table: string;
  /** The atomic upsert + delete-absent RPC for one voucher (0382). */
  replaceRpc: string;
  /** The mirror scan's columns; only the GL mirror carries `company`. */
  scanColumns: string;
  hasCompany: boolean;
}
const GL_LEDGER: LedgerTable = {
  table: 'erp_gl_entry_mirror', replaceRpc: 'replace_erp_gl_voucher_rows',
  scanColumns: 'id,erp_name,erp_modified,voucher_type,voucher_no,company', hasCompany: true,
};
const PLE_LEDGER: LedgerTable = {
  table: 'erp_payment_ledger_mirror', replaceRpc: 'replace_erp_ple_voucher_rows',
  scanColumns: 'id,erp_name,erp_modified,voucher_type,voucher_no', hasCompany: false,
};
/** Page budget for ONE voucher's current row set (20 × 500 rows); a bigger voucher is skipped and reported. */
export const VOUCHER_MAX_PAGES = 20;
/** Voucher current-set reads per source per tick. Bounds the tick well inside the edge function's
 *  150 s wall clock; the cursor holds at the first voucher not reached, so the rest finish next tick. */
export const VOUCHER_REPLACES_PER_TICK = 25;

const voucherKey = (type: unknown, no: unknown): string | null =>
  typeof type === 'string' && type !== '' && typeof no === 'string' && no !== '' ? JSON.stringify([type, no]) : null;

/** The per-row `erp_modified >=` guarded upsert. Reads the org's existing mirror rows (PAGED), drops
 *  any fetched row whose `modified` is strictly older than the stored `erp_modified`, and batch-upserts
 *  the rest (the mirror's `unique(org_id, erp_name)` makes it an idempotent upsert-by-name).
 *
 *  ⚑ MEDIUM-1 (audit round 8): this read used to be ONE unpaged request, and its error was never
 *  checked. Both holes made the guard INERT rather than red — past PostgREST's 1000-row cap every
 *  unseen row read as "not yet mirrored" and skipped the freshness check, so a stale re-delivery
 *  could overwrite newer money; a failed read did the same for EVERY row. It now pages over the
 *  mirror's `id` PK (a total, stable order) and throws on a read error: fail CLOSED, never wave
 *  money through on a map we could not build.
 *
 *  `readVoucher` (null = no reconcile, the full-replay path): a fetched voucher whose mirror copy holds
 *  a row this batch did not re-deliver may have been reposted, so its current set is read and the
 *  voucher is replaced atomically instead of upserted. */
async function upsertMirrorRows(
  sc: LedgerFeedServiceClient,
  ledger: LedgerTable,
  orgId: string,
  company: string,
  rows: Array<Record<string, unknown>>,
  readVoucher: VoucherRead | null,
): Promise<{ fed: number; holdAt: string | null; skipped: string[] }> {
  if (rows.length === 0) return { fed: 0, holdAt: null, skipped: [] };
  const { table } = ledger;
  // Read existing erp_modified per erp_name for the per-row guard (one batched read).
  const existing = new Map<string, string>();
  type MirrorKeyRow = { id: string; erp_name?: string; erp_modified?: string; voucher_type?: string | null; voucher_no?: string | null; company?: string | null };
  const mirrored = await fetchAllRowsByKeyset<MirrorKeyRow>((afterId, limit) => {
    const q = sc.from(table).select(ledger.scanColumns).eq('org_id', orgId)
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

  // Vouchers to replace: fetched here AND holding a mirror row (this company's, or a legacy NULL one)
  // that this batch did not re-deliver. Read every current set BEFORE any write.
  const replacements = new Map<string, { voucher: Voucher; rows: Array<Record<string, unknown>> }>();
  const deferred = new Set<string>();
  const skipped: string[] = [];
  let holdAt: string | null = null;
  if (readVoucher) {
    const fetchedNames = new Set(rows.map((r) => String(r.erp_name)));
    // Batch order (modified asc), so the vouchers left past the budget are the latest ones.
    const fetchedVouchers = new Map<string, { voucher: Voucher; firstModified: string }>();
    for (const r of rows) {
      const key = voucherKey(r.voucher_type, r.voucher_no);
      if (key && !fetchedVouchers.has(key)) {
        fetchedVouchers.set(key, { voucher: { type: String(r.voucher_type), no: String(r.voucher_no) }, firstModified: String(r.erp_modified) });
      }
    }
    const unseen = new Set<string>();
    for (const m of mirrored) {
      const key = voucherKey(m.voucher_type, m.voucher_no);
      if (!key || !fetchedVouchers.has(key) || fetchedNames.has(String(m.erp_name))) continue;
      if (ledger.hasCompany && m.company != null && m.company !== company) continue;
      unseen.add(key);
    }
    let reads = 0;
    for (const [key, { voucher, firstModified }] of fetchedVouchers) {
      if (!unseen.has(key)) continue;
      if (reads >= VOUCHER_REPLACES_PER_TICK) {
        deferred.add(key);
        if (holdAt === null || firstModified < holdAt) holdAt = firstModified;
        continue;
      }
      reads += 1;
      const current = await readVoucher(voucher);
      if (!current.caughtUp) {
        // Too big to read in full: remove nothing, land the batch's rows, report it, move on.
        skipped.push(`${voucher.type} ${voucher.no}`);
        continue;
      }
      // An empty set means the voucher vanished between the two reads: remove nothing on that evidence.
      if (current.rows.length > 0) replacements.set(key, { voucher, rows: current.rows });
    }
  }

  const plain = fresh.filter((r) => {
    const key = voucherKey(r.voucher_type, r.voucher_no) ?? '';
    return !replacements.has(key) && !deferred.has(key);
  });
  if (plain.length > 0) {
    const { error } = await sc.from(table).upsert(plain.map((r) => ({ ...r, org_id: orgId })), { onConflict: MIRROR_UNIQUE_KEY });
    if (error) throw new AppError(error.message, error.code);
  }
  for (const { voucher, rows: currentRows } of replacements.values()) {
    const { data, error } = await sc.rpc(ledger.replaceRpc, {
      p_org_id: orgId, p_company: company, p_voucher_type: voucher.type, p_voucher_no: voucher.no,
      p_rows: currentRows, p_current_names: currentRows.map((r) => String(r.erp_name)),
    });
    if (error) throw new AppError(error.message, error.code);
    if ((data as { stale_binding?: unknown } | null)?.stale_binding === true) {
      throw new AppError('Ledger voucher replace refused: stale binding changed during the feed', 'config-rejected');
    }
  }
  return { fed: fresh.length, holdAt, skipped };
}

function maxModified(rows: Array<{ modified: string }>): string | null {
  let max: string | null = null;
  for (const r of rows) if (max === null || r.modified > max) max = r.modified;
  return max;
}

function glRowToMirror(r: GlEntryRow): Record<string, unknown> {
  return {
    erp_name: r.name,
    company: r.company,
    is_opening: r.is_opening,
    finance_book: r.finance_book,
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
    voucher_type: r.voucher_type,
    voucher_no: r.voucher_no,
    delinked: r.delinked,
    erp_docstatus: r.docstatus,
    erp_modified: r.modified,
  };
}
