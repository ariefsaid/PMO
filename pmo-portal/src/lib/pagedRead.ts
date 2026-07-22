/**
 * The shared PAGED PostgREST reads (the money-honesty paging seam).
 *
 * PostgREST refuses to return more than `db-max-rows` rows in ONE response (`supabase/config.toml`
 * `max_rows = 1000`; 1000 is also Supabase Cloud's default "Max rows") and signals NOTHING when it
 * truncates: HTTP 200, a short body, `error === null`. So any read whose CORRECTNESS depends on
 * seeing the WHOLE set is not merely incomplete past 1000 rows — it is silently WRONG:
 *
 *   • a money SUM understates spend and then presents the shortfall as a dated, known figure
 *     (`erpnext/actualsSnapshot.ts` — Luna audit round 8 HIGH-1);
 *   • a "have I already stored this?" guard goes INERT, because every unseen row looks new
 *     (`erpnext/ledgerMirrorFeed.ts` — round 8 MEDIUM-1);
 *   • a client-side search answers "no match" for a record that exists (`db/revenue.ts`, the
 *     read-model audit that first found this class).
 *
 * This module is the ONE place those scopes share, rather than the fourth hand-rolled paging loop.
 * It is dependency-free and DENO-importable (relative `.ts` imports only), so the adapter seam —
 * imported by both Vitest and the sweep edge function — can use it.
 *
 * ── WHICH LOOP TO USE ───────────────────────────────────────────────────────────────────────────
 * Both require a TOTAL, STABLE `ORDER BY` on a unique column (the row's `id`): Postgres guarantees no
 * row order across statements, so an unordered paged scan can return one row twice and miss another.
 * They differ in what they survive:
 *
 *   `fetchAllPages`         — OFFSET (`.range(from, to)`). Repeatable, but NOT concurrency-safe: a row
 *                             INSERTED between two page reads with a lower-sorting id shifts every
 *                             later row one slot right, so the next page re-reads the row already
 *                             counted at the end of the previous one. Correct for a read of a set
 *                             nothing is writing during the scan, and for LIST reads where a
 *                             one-row wobble is cosmetic.
 *
 *   `fetchAllRowsByKeyset`  — KEYSET (`.gt('id', cursor).limit(n)`). The cursor names the row to
 *                             RESUME AFTER, so a concurrent write can neither duplicate nor skip a
 *                             row already scanned. **Every MONEY SUM uses this one** — a duplicated
 *                             row is double-counted spend, which is worse than the truncation the
 *                             paging exists to fix. (This is the repo's own round-6 NIT-2 ruling for
 *                             `getRevenueByProject`; audit round 8 applied it to the ERP mirrors,
 *                             where the 5-minute sweep cron has no single-flight guard and a slow
 *                             backfill tick therefore overlaps the next tick's scan — precisely in
 *                             the >1000-row regime that makes any of this matter.)
 */
import { AppError } from './appError.ts';

/** One page's worth of rows. Matches PostgREST's `db-max-rows`, so a page is one full response. */
export const PAGE_SCAN_SIZE = 1000;

export interface PagedReadError {
  message: string;
  code?: string;
}

export interface PageResult<T> {
  data: T[] | null;
  error: PagedReadError | null;
}

/**
 * OFFSET paging. Reads EVERY row by asking for successive inclusive `[from, to]` pages until a SHORT
 * page proves the end of the set. A page error THROWS (`AppError`, code preserved) rather than
 * resolving to a partial set: a partial answer a caller cannot distinguish from a complete one is
 * exactly the defect this module exists to remove.
 */
export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const out: T[] = [];
  for (let p = 0; ; p += 1) {
    const from = p * PAGE_SCAN_SIZE;
    const { data, error } = await page(from, from + PAGE_SCAN_SIZE - 1);
    if (error) throw new AppError(error.message, error.code);
    const rows = data ?? [];
    for (const row of rows) out.push(row);
    if (rows.length < PAGE_SCAN_SIZE) break;
  }
  return out;
}

/**
 * KEYSET paging — the loop every MONEY SUM uses. The caller's `page` builder must apply
 * `.order('id', { ascending: true })`, `.gt('id', cursor)` when the cursor is non-null, and
 * `.limit(limit)`; it must also SELECT `id`, since the cursor is read back off the last row.
 *
 * A short page proves the end of the set. A page error THROWS, so a failed scan can never be mistaken
 * for a completed one and used to replace a good figure with a partial one.
 */
export async function fetchAllRowsByKeyset<T extends { id: string }>(
  page: (afterId: string | null, limit: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (;;) {
    const { data, error } = await page(cursor, PAGE_SCAN_SIZE);
    if (error) throw new AppError(error.message, error.code);
    const rows = data ?? [];
    for (const row of rows) out.push(row);
    if (rows.length < PAGE_SCAN_SIZE) break;
    cursor = String(rows[rows.length - 1]!.id);
  }
  return out;
}
