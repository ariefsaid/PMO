/**
 * Injected-fetch Frappe/ERPNext v1 stock-REST HTTP wrapper (FR-ENA-013, AC-ENA-011). The ONLY place
 * ERPNext auth/URL/error-taxonomy vocabulary lives — confined to erpnext/**. Every test injects
 * `fetchImpl`; no real bench is ever required to exercise this module.
 *
 * Classification (R9 §6.7 + docs/spikes/2026-07-11-erpnext-pe-mandatory-fields.md): parse `exc_type`
 * first, then `_server_messages` (a JSON-encoded array of JSON-encoded `{message}` objects) for
 * display. 4xx (incl. 404 DoesNotExistError) -> `commit-rejected`; a raw `500` whose body carries
 * `TypeError` (the R9 empty-`items` crash) -> a DISTINCT non-retryable `commit-rejected` bucket
 * (FR-ENA-042 — never blind-retried); 429/other 5xx -> retried with backoff (honoring `Retry-After`)
 * UNLESS the request is a non-idempotent `POST` (FR-ENA-042's no-blind-retry guard: a POST gets
 * exactly one attempt — a create's ERP-side effect may already have landed, so only the guarded
 * recovery algorithm above this module may safely re-issue it, never this client).
 */
import { AdapterError } from '../contract.ts';

/** A classified ERPNext HTTP failure — carries the raw status + a `retryable` flag so callers (the
 *  outbox recovery algorithm) can distinguish the R9 500-TypeError bucket from an ordinary rejection. */
export class ErpError extends AdapterError {
  readonly status: number;
  readonly retryable: boolean;
  constructor(status: number, code: 'commit-rejected' | 'external-unreachable', message: string, retryable = true) {
    super(code, message);
    this.name = 'ErpError';
    this.status = status;
    this.retryable = retryable;
  }
}

/** A modest per-org token bucket (FR-ENA-014 — "Frappe rate-limiting is off by default"; this is a
 *  courtesy budget sized for worker-pool concurrency, not a hard quota). Optional — omitted in tests
 *  and any caller that doesn't need it (a true no-op, byte-for-byte). */
export interface ErpRateLimiter {
  acquire(): Promise<void>;
}

export interface ErpClientDeps {
  /** The injected fetch implementation (mocked in every test — NFR-ENA-CONTRACT-001). */
  fetchImpl: typeof fetch;
  /** `Authorization: token <apiKey>:<apiSecret>` (FR-ENA-013). Resolved from `secret_ref` at the
   *  edge-fn boundary only — never read from env/DB here (NFR-ENA-SEC-002). */
  apiKey: string;
  apiSecret: string;
  /** Per-org `external_org_bindings.site_url` — no default (unlike ClickUp's single global API). */
  baseUrl: string;
  /** Bounded retry budget for a retryable (429/5xx) response on an IDEMPOTENT request (default 3);
   *  a non-idempotent POST always gets exactly one attempt regardless of this budget. */
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Awaited once before every attempt (create + each retry) when present — the per-org factory
   *  (2.13) shares ONE instance across a request so the budget is real, not per-call. */
  rateLimiter?: ErpRateLimiter;
  /** Per-ATTEMPT request deadline in ms (default `ERP_REQUEST_TIMEOUT_MS`). Bounds how long a single
   *  ERP request may hang before it is aborted — see `ERP_REQUEST_TIMEOUT_MS` for WHY the default is
   *  tied to the outbox quarantine window. Overridden only by tests (a few ms) and callers with a
   *  tighter budget; a value ≥ the quarantine window would re-open the double-commit race. */
  timeoutMs?: number;
}

/**
 * The outbox quarantine reclaim window (ADR-0058 §2 F1 / migration 0096 `quarantine_committing`'s
 * `p_window default interval '5 minutes'`): a stale `committing` row becomes reconcilable — and, for
 * an IMMUTABLE-anchor kind, REISSUABLE — at `claimed_at + 5 minutes`. Mirrored here as a constant so
 * the request deadline below can be reasoned about (and asserted) against it.
 */
export const ERP_QUARANTINE_WINDOW_MS = 5 * 60_000;

/**
 * The default per-attempt ERP request deadline (Luna BLOCK 5 — the double-pay window).
 *
 * WHY 2 minutes, and why it MUST relate to `ERP_QUARANTINE_WINDOW_MS`: an unbounded `POST` can hang
 * past the outbox's quarantine reclaim (`claimed_at + 5 min`, migration 0096). Recovery would then
 * probe, miss the not-yet-visible document and — for a reissue-capable (immutable-anchor) kind,
 * ADR-0058 C-1 — re-`POST` under the same key while the ORIGINAL request is still alive and can still
 * commit ⇒ TWO ERP money documents, the exact defect the outbox exists to prevent.
 *
 * Bounding every attempt at 2 minutes makes that impossible by construction: the request is aborted
 * at `claim + ~120 s`, leaving ≥180 s of settle time before the EARLIEST possible reissue at
 * `claim + 300 s` — ample for a document the server nonetheless committed to land and become
 * anchor-probe-visible, so the post-window probe adopts it instead of duplicating it. (An abort is a
 * client-side signal — it does NOT guarantee ERP rolls back — which is precisely why the margin, not
 * the abort, is what carries the safety guarantee.) ADR-0058 C-1's mutable-anchor kinds (Payment
 * Entry) remain held-never-reissued regardless; this constant closes the window for the kinds that
 * ARE reissue-capable.
 *
 * It is also comfortably above any realistic ERPNext money-document commit (the R9 live bench measured
 * sub-second submits), so a legitimate slow save is never cut short.
 */
export const ERP_REQUEST_TIMEOUT_MS = 120_000;

/**
 * Escapes the SQL `LIKE` metacharacters (`%`, `_`) and the escape character itself (`\`) so a value
 * interpolated into a `LIKE` pattern can only ever match ITSELF, literally (Luna BLOCK 1).
 *
 * The recovery probe (ADR-0058 §3) filters the anchor field by the CALLER-SUPPLIED idempotency key.
 * Unescaped, a key carrying `%`/`_` becomes a wildcard pattern and the recovery path can adopt — then
 * submit or cancel — a DIFFERENT org member's money document. Backslash is the default `LIKE` escape
 * character in both MariaDB (Frappe's usual backend) and Postgres, and the key travels as a bound
 * parameter, so the escaped value reaches the pattern verbatim.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export interface ErpRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Full path incl. leading slash, already doctype/name-encoded by the doctypePath() helper below. */
  path: string;
  body?: unknown;
}

interface ParsedFrappeError {
  excType?: string;
  message?: string;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Parses a Frappe error body: `exc_type` first, then `_server_messages` (JSON-in-JSON) for a
 *  human message, falling back to `exception`/`message` (R9 §6.7). Never throws on a malformed body. */
function parseFrappeErrorBody(body: unknown): ParsedFrappeError {
  if (!body || typeof body !== 'object') return {};
  const b = body as Record<string, unknown>;
  const excType = typeof b.exc_type === 'string' ? b.exc_type : undefined;
  let message: string | undefined;
  if (typeof b._server_messages === 'string') {
    try {
      const outer = JSON.parse(b._server_messages) as unknown[];
      const first = outer[0];
      const inner = typeof first === 'string' ? (JSON.parse(first) as { message?: string }) : (first as { message?: string } | undefined);
      message = inner?.message;
    } catch {
      // malformed _server_messages — fall through to the other fields below.
    }
  }
  if (!message && typeof b.exception === 'string') message = b.exception;
  if (!message && typeof b.message === 'string') message = b.message;
  return { excType, message };
}

/** The R9 empty-`items` crash bucket: a raw `500` whose classification carries `TypeError`, either
 *  as `exc_type` or as the leading token of the traceback message (FR-ENA-013/042). */
function isTypeErrorBucket(parsed: ParsedFrappeError): boolean {
  return parsed.excType === 'TypeError' || Boolean(parsed.message?.startsWith('TypeError'));
}

async function safeParseBody(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Issues one classified, backoff-retried Frappe/ERPNext REST request. A non-idempotent `POST` is
 * NEVER blindly retried (FR-ENA-042) — every other method retries a transient 429/5xx up to
 * `maxRetries` (honoring `Retry-After`).
 */
export async function erpnextRequest(deps: ErpClientDeps, opts: ErpRequestOptions): Promise<unknown> {
  const sleep = deps.sleep ?? defaultSleep;
  const maxRetries = opts.method === 'POST' ? 0 : (deps.maxRetries ?? 3);
  const headers = {
    Authorization: `token ${deps.apiKey}:${deps.apiSecret}`,
    'Content-Type': 'application/json',
  };

  const timeoutMs = deps.timeoutMs ?? ERP_REQUEST_TIMEOUT_MS;

  let attempt = 0;
  for (;;) {
    if (deps.rateLimiter) await deps.rateLimiter.acquire();
    let res: Response;
    // Luna BLOCK 5: bound EVERY attempt with a deadline strictly shorter than the outbox quarantine
    // reclaim window, so a hung-but-alive request can never still be able to commit while recovery
    // has already started a second POST (see ERP_REQUEST_TIMEOUT_MS). The controller/timer is
    // per-attempt and always cleared, so a settled request leaves no dangling timer or handle.
    const controller = new AbortController();
    const deadline = setTimeout(
      () => controller.abort(new Error(`ERPNext request exceeded its ${timeoutMs}ms deadline`)),
      timeoutMs,
    );
    try {
      res = await deps.fetchImpl(`${deps.baseUrl}${opts.path}`, {
        method: opts.method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (attempt < maxRetries) {
        attempt += 1;
        await sleep(500 * attempt);
        continue;
      }
      // Server-only module (creds) — log the real cause; the client-facing error stays typed/generic.
      console.error(`[erpnext-client] fetch failed ${opts.method} ${opts.path}:`, err instanceof Error ? err.message : String(err));
      throw new ErpError(0, 'external-unreachable', err instanceof Error ? err.message : 'ERPNext request failed', true);
    } finally {
      clearTimeout(deadline);
    }

    if (res.status === 429 || res.status >= 500) {
      const body = await safeParseBody(res);
      const parsed = parseFrappeErrorBody(body);
      // The 500-TypeError bucket is non-retryable regardless of method or remaining budget.
      if (res.status === 500 && isTypeErrorBucket(parsed)) {
        throw new ErpError(500, 'commit-rejected', parsed.message ?? 'ERPNext server error (TypeError)', false);
      }
      if (attempt < maxRetries) {
        attempt += 1;
        const retryAfterHeader = res.headers.get('Retry-After');
        const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 500 * attempt;
        await sleep(retryAfterMs);
        continue;
      }
      console.error(`[erpnext-client] upstream ${res.status} ${opts.method} ${opts.path}:`, (parsed.message ?? '').slice(0, 300));
      throw new ErpError(res.status, 'external-unreachable', parsed.message ?? `ERPNext request failed with status ${res.status}`, true);
    }

    const body = await safeParseBody(res);
    if (res.status >= 400) {
      const parsed = parseFrappeErrorBody(body);
      throw new ErpError(res.status, 'commit-rejected', parsed.message ?? `ERPNext request failed with status ${res.status}`, true);
    }
    return body;
  }
}

/** Builds `/api/resource/<DocType>[/<name>]`, URL-encoding spaces (and any other reserved chars) in
 *  both the doctype name and the record name (FR-ENA-013). */
function doctypePath(doctype: string, name?: string): string {
  const base = `/api/resource/${encodeURIComponent(doctype)}`;
  return name !== undefined ? `${base}/${encodeURIComponent(name)}` : base;
}

/**
 * Frappe's real `/api/resource/<DocType>[/<name>]` single-doc response (POST create / GET single /
 * PUT update-submit-cancel) is wrapped in `{data: {...fields}}` (task 6.4 fix-round,
 * live-bench-discovered 2026-07-12 — no prior unit test observed a real HTTP round-trip, since no
 * e2e ever reached one before task 6.4 wired the money outbox). Unwraps ONLY when a non-array object
 * `.data` key is present (the real envelope shape) — a `.data` ARRAY (the list-query shape,
 * `listDocNamesByAnchor`'s own endpoint) and any other shape (every existing mocked test fixture,
 * which returns the flat fields directly) pass through UNCHANGED, so no existing test needs updating.
 */
export function unwrapFrappeDoc(body: unknown): unknown {
  if (
    body !== null &&
    typeof body === 'object' &&
    'data' in body &&
    (body as { data: unknown }).data !== null &&
    typeof (body as { data: unknown }).data === 'object' &&
    !Array.isArray((body as { data: unknown }).data)
  ) {
    return (body as { data: unknown }).data;
  }
  return body;
}

/** `POST /api/resource/<DocType>` — insert as draft. Never blindly retried (FR-ENA-042); a
 *  duplicate-create risk on retry is guarded by the outbox above this module, not here. */
export async function createDoc(deps: ErpClientDeps, doctype: string, body: unknown): Promise<unknown> {
  return unwrapFrappeDoc(await erpnextRequest(deps, { method: 'POST', path: doctypePath(doctype), body }));
}

/** `GET /api/resource/<DocType>/<name>` — used for the post-submit re-fetch (R9 §5 stale-status
 *  trap) and for reference lookups (e.g. `GET Company/<name>`). */
export async function getDoc(deps: ErpClientDeps, doctype: string, name: string): Promise<unknown> {
  return unwrapFrappeDoc(await erpnextRequest(deps, { method: 'GET', path: doctypePath(doctype, name) }));
}

/** `PUT /api/resource/<DocType>/<name>` `{docstatus:1}` — submit (FR-ENA-044). */
export async function submitDoc(deps: ErpClientDeps, doctype: string, name: string): Promise<unknown> {
  return unwrapFrappeDoc(await erpnextRequest(deps, { method: 'PUT', path: doctypePath(doctype, name), body: { docstatus: 1 } }));
}

/** `PUT /api/resource/<DocType>/<name>` `{docstatus:2}` — cancel (OQ-8: stock REST enforces
 *  cancel-only, never delete, on a once-submitted doc). */
export async function cancelDoc(deps: ErpClientDeps, doctype: string, name: string): Promise<unknown> {
  return unwrapFrappeDoc(await erpnextRequest(deps, { method: 'PUT', path: doctypePath(doctype, name), body: { docstatus: 2 } }));
}

/** `PUT /api/resource/<DocType>/<name>` with a plain field patch, no `docstatus` (task 3.3) — a
 *  non-submittable doctype (a party — Supplier/Customer) has no docstatus lifecycle, so its update
 *  is a direct field PUT (never `submitDoc`/`cancelDoc`'s docstatus transition). */
export async function updateDoc(deps: ErpClientDeps, doctype: string, name: string, body: unknown): Promise<unknown> {
  return unwrapFrappeDoc(await erpnextRequest(deps, { method: 'PUT', path: doctypePath(doctype, name), body }));
}

/** `GET /api/method/<rpc>` — the Frappe RPC surface (e.g. the version handshake). */
export function callMethod(deps: ErpClientDeps, methodPath: string): Promise<unknown> {
  return erpnextRequest(deps, { method: 'GET', path: `/api/method/${methodPath}` });
}

/**
 * The ADR-0058 §3 recovery-probe query: list the `name`s of `<DocType>` docs whose stock anchor
 * field (`anchorField`) carries the idempotency key
 * (`GET /api/resource/<DocType>?filters=[[<anchorField>,"like","%<key>%"]`).
 * Returns at most `limit` names (default 1 — an idempotency key stamps exactly one doc). A `GET` is
 * idempotent so the standard retry/backoff applies (unlike a create POST). The anchor stamp is
 * written by `adapter.ts`'s `stampAnchor` on every create; the anchor FIELD is per-doctype
 * (doctypeRegistry's `anchorField` — 'remarks' for PI/Purchase Receipt, 'reference_no' for Payment
 * Entry per the DIRECTOR RULING, ADR-0058 §3).
 */
export async function listDocNamesByAnchor(
  deps: ErpClientDeps,
  doctype: string,
  anchorField: string,
  idempotencyKey: string,
  limit = 1,
): Promise<string[]> {
  // Luna BLOCK 1: the key is caller-supplied — escape `LIKE` metacharacters so it can only match
  // ITSELF (an unescaped `%`/`_` would turn the probe into a wildcard search and let recovery adopt
  // somebody else's money document). The leading/trailing `%` stay real wildcards: the anchor value
  // is the key, but the surrounding-tolerant match is what the live bench verified (ADR-0058 §3).
  const filters = encodeURIComponent(JSON.stringify([[anchorField, 'like', `%${escapeLikePattern(idempotencyKey)}%`]]));
  const path = `${doctypePath(doctype)}?filters=${filters}&limit_page_length=${limit}`;
  const res = await erpnextRequest(deps, { method: 'GET', path });
  const data = (res as { data?: Array<{ name?: unknown }> } | null)?.data;
  if (!Array.isArray(data)) return [];
  return data.map((d) => String(d.name)).filter((n) => n !== 'undefined');
}

/** A Frappe filter tuple `[field, operator, value]` (server-filterable columns only — child-table
 *  fields like Payment Entry `references` are NOT filterable and must be matched after `getDoc`). */
export type ErpFilter = [string, string, string | number];

/**
 * List `<DocType>` doc `name`s matching a conjunction of server-filterable `filters` (the C-1 composite
 * PE recovery probe, ADR-0058 §4 — when the mutable `reference_no` anchor alone cannot find a landed
 * Payment Entry, a deterministic party_type+party+paid_amount+creation-window conjunction narrows the
 * candidates before a child-table `references` match). A `GET`, so the standard retry/backoff applies.
 */
export async function listDocNamesByFilters(
  deps: ErpClientDeps,
  doctype: string,
  filters: ErpFilter[],
  limit = 20,
): Promise<string[]> {
  const encoded = encodeURIComponent(JSON.stringify(filters));
  const path = `${doctypePath(doctype)}?filters=${encoded}&limit_page_length=${limit}`;
  const res = await erpnextRequest(deps, { method: 'GET', path });
  const data = (res as { data?: Array<{ name?: unknown }> } | null)?.data;
  if (!Array.isArray(data)) return [];
  return data.map((d) => String(d.name)).filter((n) => n !== 'undefined');
}
