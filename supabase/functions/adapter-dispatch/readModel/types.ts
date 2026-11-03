import type { AdapterCommand, PmoRecord } from '../../../../pmo-portal/src/lib/adapterSeam/contract.ts';

export interface ReadModelServiceClient {
  from(table: string): {
    insert(row: unknown): Promise<{ error: { message: string; code?: string } | null }>;
    upsert(
      rows: unknown,
      // `ignoreDuplicates` is supabase-js's "insert … on conflict do nothing" — needed by the
      // append-only sales_invoice_authors writer (a repeat body-writer must be a no-op, not an error).
      options: { onConflict: string; ignoreDuplicates?: boolean },
    ): Promise<{ error: { message: string; code?: string } | null }>;
    update(patch: unknown): ReadModelEqChain;
    select(columns: string): ReadModelSelectChain;
  };
  // Fenced outcome writers (migration 0155): a mirror write that must read the outbox atomically to
  // avoid a TOCTOU race routes through a security-definer RPC rather than a bare upsert.
  rpc(fn: string, args: Record<string, unknown>): Promise<{ error: { message: string; code?: string } | null }>;
}
export interface ReadModelEqChain {
  eq(column: string, value: string | number | boolean): ReadModelEqChain;
  in(column: string, values: readonly unknown[]): ReadModelEqChain;
  is(column: string, value: boolean | null): ReadModelEqChain;
  select(columns: string): PromiseLike<{
    data: unknown[] | null;
    error: { message: string; code?: string } | null;
  }>;
}
export interface ReadModelSelectChain {
  eq(column: string, value: string | number | boolean): ReadModelSelectChain;
  maybeSingle(): PromiseLike<{
    data: Record<string, unknown> | null;
    error: { message: string; code?: string } | null;
  }>;
}

export interface ReadModelWriterCtx {
  serviceClient: ReadModelServiceClient;
  orgId: string;
  /** Luna BLOCK 4: the dispatch caller's resolved user id (index.ts `verified.sub`), threaded in so a
   *  PMO-created sales invoice stamps `author_user_id` = the creator — the submit_sales_invoice SoD
   *  (approver≠author) is otherwise a no-op when author is null. Undefined on an inbound-adopted path
   *  (no PMO caller) → author_user_id stays null (SoD-exempt). */
  callerUserId?: string;
  /** ⚑ BLOCKER 2 (FU-2): true when this write is a REPLAY convergence (`reconcileOutbox`/finalize of an
   *  already-committed or confirmed outbox row) rather than a FRESH ERP commit in this dispatch. A replay
   *  carries no new ERP-side success, so a PMO-SoT writer must not use it to override a Desk cancel
   *  (the budget writer's tombstone guard). Undefined ⇒ a fresh write (today's behaviour). */
  isReplay?: boolean;
}

export interface ReadModelWriter {
  /** Write the canonical record into this domain's read-model. `command` carries the operation
   *  (create vs update/transition) and the original record fields (e.g. `project_id` on a task
   *  create), matching the fields the pre-1.6 inline branch relied on. */
  upsert(ctx: ReadModelWriterCtx, canonical: PmoRecord, command: AdapterCommand): Promise<void>;
  /** Tombstone-aware domains only (P1 `tasks`, AC-CUA-038) — omitted elsewhere. */
  tombstone?(ctx: ReadModelWriterCtx, pmoRecordId: string): Promise<void>;
}
