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
  /**
   * Luna round-5 BLOCK 10 — the ABSOLUTE instant (ms, `Date.now()` domain) past which a NON-IDEMPOTENT
   * `POST` must be REFUSED. Armed per command by the money dispatch's claim (see
   * `AdapterCommand.commitDeadlineAtMs`) and applied here because `erpnextRequest` is the ONE
   * chokepoint every ERPNext create passes through — so no doctype, verb or future adapter path can
   * forget the check. Absent ⇒ unbounded (every read path, P0/P1, and any non-claimed commit).
   */
  commitDeadlineAtMs?: number;
  /** Injectable clock (ms) for the commit-deadline check. Defaults to `Date.now`; tests drive it. */
  now?: () => number;
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
 * The per-attempt deadline for a RECOVERY-PROBE request (money-safety audit BLOCK 1).
 *
 * The probe is the first thing a claim winner does, and it is a `GET` — so under the DEFAULT budget it
 * retries (`maxRetries` 3) at 120 s per attempt: ~483 s worst case, LONGER than the entire 300 s
 * quarantine window. That let a claimant finish probing only after its row had been quarantined,
 * reclaimed and reissued, and then still `POST` — two ERP money documents. `dispatch.ts`'s claim
 * budget refuses that POST, but the probe must ALSO be prevented from silently eating the whole
 * window: an answer that cannot arrive inside the claim budget is not an answer, it is an outage, and
 * must surface as `external-unreachable` promptly so the reconciler takes over.
 *
 * 20 s is generous for a single indexed Frappe list query (the live bench measured sub-second) and
 * comfortably inside `MONEY_COMMIT_CLAIM_BUDGET_MS`.
 */
export const ERP_PROBE_TIMEOUT_MS = 20_000;

/**
 * The maximum `Retry-After` this client will honor (money-safety audit SHOULD-FIX).
 *
 * `Retry-After` is server-controlled and was honored VERBATIM — a `Retry-After: 300` therefore parked a
 * request for the entire quarantine window. That matters because the claim budget
 * (`MONEY_COMMIT_CLAIM_BUDGET_MS`, dispatch.ts) is checked ONCE, before `adapter.commit`, while a
 * commit can issue SEVERAL ERP calls: the amend path is `cancel (PUT)` → `create (POST)`, so a long
 * honored sleep inside the cancel pushes the non-idempotent POST far outside the window this claimant
 * was admitted for — precisely the state the budget exists to refuse.
 *
 * Capping the honored value keeps the courtesy behavior (a real rate-limit hint is respected) while
 * bounding it well inside the claim budget. A retry that a genuinely overloaded ERP wanted delayed
 * longer simply exhausts the retry budget and surfaces `external-unreachable`, which the outbox
 * recovery path already handles safely.
 */
export const ERP_RETRY_AFTER_CAP_MS = 15_000;

/** The retry budget an IDEMPOTENT request gets when the caller does not override `maxRetries`. Named
 *  (rather than inlined at the `??`) because the worst-case in-flight budget below is DERIVED from it —
 *  a silent change here must move that budget, and the SoD clearance TTL with it. */
export const ERP_DEFAULT_MAX_RETRIES = 3;

/**
 * The worst-case wall-clock ONE idempotent ERP request can occupy: every attempt may burn its full
 * per-attempt deadline, and every retry may wait the full capped `Retry-After`.
 *
 * (A non-idempotent `POST` is exempt — it gets exactly one attempt, FR-ENA-042.)
 */
export const ERP_IDEMPOTENT_REQUEST_MAX_MS =
  (ERP_DEFAULT_MAX_RETRIES + 1) * ERP_REQUEST_TIMEOUT_MS + ERP_DEFAULT_MAX_RETRIES * ERP_RETRY_AFTER_CAP_MS;

/**
 * How many full-budget ERP requests ONE submit dispatch can issue: the outbox recovery probe, the
 * `PUT {docstatus:1}` submit, and the mandatory post-submit re-fetch (`adapter.ts` `commitTransition`,
 * `verb:'submit'`). The probe actually runs on the tighter `ERP_PROBE_TIMEOUT_MS` single-attempt budget,
 * so counting it as a full one is deliberately conservative.
 */
export const ERP_SUBMIT_MAX_ERP_REQUESTS = 3;

/**
 * The LONGEST a Sales Invoice submit can still be in flight — i.e. the longest a body rewrite must stay
 * refused after the submit was authorized (round-7 cross-family audit, B1a).
 *
 * The SoD submit clearance (`sales_invoice_submit_authorizations`) is what refuses a concurrent body
 * rewrite, and migration 0113 gave it a hand-picked 5-minute TTL — SHORTER than this. The clearance
 * therefore lapsed while the submit was still running, and the approver could then claim authorship,
 * rewrite the amount, and have the in-flight submit commit their own numbers under their own earlier
 * approval. The clearance TTL is now derived from this value, and `submitClearanceTtl.test.ts` asserts
 * the migration honours it so the two cannot drift apart.
 */
export const ERP_SUBMIT_MAX_IN_FLIGHT_MS = ERP_SUBMIT_MAX_ERP_REQUESTS * ERP_IDEMPOTENT_REQUEST_MAX_MS;

/**
 * Applies the recovery-probe budget to a client: exactly ONE attempt (no retry into the claim budget)
 * with the tighter `ERP_PROBE_TIMEOUT_MS` deadline. Returns a COPY — the caller's own client (which a
 * sweep also uses for its doctype polling, where the normal retry budget is correct) is untouched.
 */
export function withProbeBudget(deps: ErpClientDeps): ErpClientDeps {
  return { ...deps, maxRetries: 0, timeoutMs: ERP_PROBE_TIMEOUT_MS };
}

/**
 * Applies a claim's ABSOLUTE commit deadline to a client (Luna round-5 BLOCK 10): past `deadlineAtMs`
 * this client refuses to issue a non-idempotent `POST`. Returns a COPY — the caller's own client
 * (shared with reads and with other commands) is untouched.
 */
export function withCommitDeadline(deps: ErpClientDeps, deadlineAtMs: number): ErpClientDeps {
  return { ...deps, commitDeadlineAtMs: deadlineAtMs };
}

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

/** How long to wait before the next attempt: the server's `Retry-After` hint, CAPPED at
 *  `ERP_RETRY_AFTER_CAP_MS` (see that constant), else the linear backoff. A non-numeric header (the
 *  HTTP-date form) is ignored rather than coerced to `NaN` — which previously made `sleep(NaN)` return
 *  immediately, silently turning the backoff off exactly when the server asked for it. */
function retryDelayMs(retryAfterHeader: string | null, attempt: number): number {
  const linear = 500 * attempt;
  if (!retryAfterHeader) return linear;
  const seconds = Number(retryAfterHeader);
  if (!Number.isFinite(seconds) || seconds < 0) return linear;
  return Math.min(seconds * 1000, ERP_RETRY_AFTER_CAP_MS);
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
  const maxRetries = opts.method === 'POST' ? 0 : (deps.maxRetries ?? ERP_DEFAULT_MAX_RETRIES);
  const headers = {
    Authorization: `token ${deps.apiKey}:${deps.apiSecret}`,
    'Content-Type': 'application/json',
  };

  const timeoutMs = deps.timeoutMs ?? ERP_REQUEST_TIMEOUT_MS;

  let attempt = 0;
  for (;;) {
    // Luna round-5 BLOCK 10 — the CLAIM BUDGET, enforced HERE, at the one place every non-idempotent
    // create is issued. `dispatch.ts` checks the budget once before `adapter.commit`, but an ERPNext
    // commit is often several calls (an amend is `cancel` PUT → `create` POST): a slow cancel could
    // push the POST past the outbox's `reconcile_after`, by which time a reconciler may already have
    // reissued the command ⇒ TWO ERP money documents. Past the deadline this claim is possibly already
    // superseded, so the POST is refused and classified RETRYABLE `external-unreachable`: the dispatch
    // marks NOTHING, the outbox row stays `committing` and the reconciler owns it (ADR-0058 §4).
    // Idempotent methods are deliberately unaffected — a submit/cancel/GET stays safely re-issuable,
    // and refusing them would strand a committed document.
    if (
      opts.method === 'POST' &&
      deps.commitDeadlineAtMs !== undefined &&
      (deps.now?.() ?? Date.now()) >= deps.commitDeadlineAtMs
    ) {
      throw new ErpError(
        0,
        'external-unreachable',
        'commit-claim-budget-exhausted: refusing a non-idempotent POST past this claim\'s deadline',
        true,
      );
    }
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
        await sleep(retryDelayMs(res.headers.get('Retry-After'), attempt));
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
