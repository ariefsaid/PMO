/** Shared types + the one pure command-shape predicate for the ERPNext dispatch-preparation modules
 *  (T-31 / ADP-021 / XG04-004: the former single 1,700-line factory split by business area).
 *  `dispatchFactory.ts` stays the caller-facing seam — the per-domain preparation lives in
 *  `dispatchPreflight.ts` (cross-org + project gates), `dispatchRefs.ts` (shared project/party
 *  mapping), `dispatchBudget.ts`, `dispatchTimesheet.ts`, `dispatchProcurement.ts` and
 *  `dispatchRevenue.ts`, with the factory retaining ONLY the ordered orchestration.
 *  Type-only + one pure predicate: nothing here reads a database or ERP, so every domain module
 *  (and the factory) can depend on it without cycles or side effects. */
import type { ErpDocKind } from './doctypeRegistry.ts';
import type { DoctypeBodyFns } from './adapter.ts';
import type { ErpRateLimiter } from './client.ts';
import type { AdapterCommand } from '../contract.ts';

/** Structural service-role client seam (matches supabase-js): `.from(t).select(c).eq(...)[.eq(...)]
 *  [.order(...).limit(...)][.maybeSingle()]` — every filter-builder is ALSO directly awaitable
 *  (matching real supabase-js's thenable `PostgrestFilterBuilder`, the shape a bare list query — e.g.
 *  Slice 5's `procurement_items` read, task 5.3 — resolves through with no terminal call). Strict
 *  superset of the pre-Slice-5 shape (`.eq().eq().maybeSingle()`), so every earlier caller/mock is
 *  unaffected. */
export interface DispatchServiceClient {
  from(table: string): {
    select(columns: string): DispatchFilterBuilder;
  };
}
export interface DispatchFilterBuilder extends PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> {
  eq(column: string, value: string | boolean): DispatchFilterBuilder;
  is(column: string, value: null): DispatchFilterBuilder;
  gte(column: string, value: string): DispatchFilterBuilder;
  order(column: string, opts?: { ascending?: boolean }): DispatchFilterBuilder;
  limit(n: number): DispatchFilterBuilder;
  /** The KEYSET cursor: resume strictly AFTER the last row of the previous page. */
  gt(column: string, value: string): DispatchFilterBuilder;
  maybeSingle(): Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
}

export interface ExternalOrgBindingRow {
  site_url: string;
  version_major: number | null;
  activated_at: string | null;
  config: Record<string, unknown>;
}

export interface ProcurementSourceLine {
  name: string;
  description?: string | null;
  quantity: number | string;
  rate: number | string | null;
}

export interface ErpDispatchFactoryDeps {
  serviceClient: DispatchServiceClient;
  orgId: string;
  command: AdapterCommand;
  fetchImpl: typeof fetch;
  /** Resolved from `secret_ref` at the edge-fn boundary (vault `AS`/fn secrets) — never read here. */
  apiKey: string;
  apiSecret: string;
  /** A modest per-org token bucket (FR-ENA-014), shared across a request. Optional. */
  rateLimiter?: ErpRateLimiter;
  /** The (kind)->{toBody,fromDoc} side table — empty until slices 3-6 wire real doctype bodies. */
  doctypeBodies?: Partial<Record<ErpDocKind, DoctypeBodyFns>>;
  /** Threaded straight into `ErpAdapterDeps.afterSubmitHook` (FR-ENA-003 — the `after-submit-before-
   *  mirror` fault seam, wired by the edge fn at task 2.14). Optional — a production caller that
   *  never arms the fault gate can omit it (a true no-op). */
  afterSubmitHook?: () => Promise<void>;
  /** Threaded straight into `ErpAdapterDeps.afterCancelHook` (⚑ HIGH-1 — the `after-cancel-before-create`
   *  fault seam). Optional; omitted callers are a true no-op. */
  afterCancelHook?: () => Promise<void>;
  /** #858: a sweep recovery of an already-persisted command. A sales-invoice create then keeps the server-built `items`/`taxes`
   *  the outbox payload already carries (they are inside its digest) and makes no ERPNext read; only the foreground create resolves them. */
  replay?: boolean;
  /** Set only after the persisted receipt witness is verified by the server. */
  trustedReceiptSnapshot?: boolean;
  /** Server-owned observation of the source rows used to build an ERP case command. */
  captureProcurementSourceLines?: (lines: ProcurementSourceLine[]) => void;
  /** ECA-6: told the id of the recorded consent that let a budget push amend an ERP budget PMO did not create, so the
   *  edge function can spend it once the push has landed. Never read from the payload. */
  onOccupantConsent?: (consentId: string) => void;
}

/**
 * Does this command BUILD a Sales Invoice body (and therefore decide whether the ERP document
 * carries a `project` dimension)? Luna re-audit BLOCK #12 — the gate used to ask "is this a create?",
 * which left the amend path wide open:
 *   - `create`                      -> `bodies/salesInvoice.toBody`
 *   - `update`                      -> a draft field PUT, or routeEdit(1) -> commitAmend, both of
 *                                      which rebuild the body
 *   - `transition{verb:'amend'}`    -> commitAmend (cancel + create-with-`amended_from`)
 * `submit`/`cancel` transitions act on an EXISTING document and build no body, so the gate must not
 * (and does not) touch them.
 *
 * Exported because `adapter-dispatch/index.ts` enforces the OTHER half of the same gate (the
 * "projectId present at all" check) and the two must never disagree about which operations qualify.
 * Shared by the pre-flight (`dispatchPreflight.assertSiProjectGate`), the revenue and procurement
 * ref resolvers, and the factory's item validation — the ONE definition of "this operation rebuilds
 * the body".
 */
export function buildsSalesInvoiceBody(command: { operation: string; record: { verb?: unknown } }): boolean {
  const operation = String(command.operation);
  if (operation === 'create' || operation === 'update') return true;
  if (operation === 'transition') return command.record.verb === 'amend';
  return false;
}
