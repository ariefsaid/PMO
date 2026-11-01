/**
 * Injected-fetch ClickUp REST v2 HTTP wrapper (FR-CUA-090/091/092). The ONLY place the ClickUp auth
 * header + base URL live — confined to clickup/**. Every test injects `fetchImpl`; no real token is
 * ever required to exercise this module.
 */
import { AdapterError } from '../contract.ts';
import {
  withBackoff,
  readClickUpRateLimitHeaders,
  type ClickUpLanePriority,
  type ClickUpRateLimiter,
  type ClickUpRateLimitHeaders,
} from './rateLimit.ts';

const DEFAULT_BASE_URL = 'https://api.clickup.com/api/v2';

/** Per-ATTEMPT request deadline: the same 20s budget as `ERP_PROBE_TIMEOUT_MS` / the edge-fn
 *  `OUTBOUND_FETCH_TIMEOUT_MS`. A hung ClickUp host aborts here and surfaces as `external-unreachable`
 *  instead of stalling a sweep until the platform kills the worker. (Inlined, not imported from the edge
 *  `_shared/fetchWithDeadline.ts`: this module is app-tree code and must not depend on supabase/.) */
export const CLICKUP_REQUEST_TIMEOUT_MS = 20_000;

/** One bounded attempt: aborts `fetchImpl` after `timeoutMs`, rejecting with a deterministic timeout error. */
async function fetchOnce(fetchImpl: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (timedOut) throw new Error(`ClickUp request exceeded its ${timeoutMs}ms deadline`, { cause: err });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** A classified ClickUp HTTP failure — carries the raw status so callers (e.g. reads.ts's 404 ->
 * null) can branch on it, while still satisfying `instanceof AdapterError` for every other caller. */
export class ClickUpHttpError extends AdapterError {
  readonly status: number;
  constructor(status: number, code: 'commit-rejected' | 'external-unreachable', message: string) {
    super(code, message);
    this.name = 'ClickUpHttpError';
    this.status = status;
  }
}

export interface ClickUpClientDeps {
  /** The injected fetch implementation (mocked in every test — NFR-CUA-CONTRACT-001). */
  fetchImpl: typeof fetch;
  /** `Authorization` header value — read from `CLICKUP_API_TOKEN` by the edge-function caller only. */
  token: string;
  baseUrl?: string;
  rateLimiter?: ClickUpRateLimiter;
  /** Optional sink for the `X-RateLimit-*` headers off the FINAL response of every request (success or
   *  failure, after any retry/backoff) — lets a caller (e.g. the sweep) throttle bulk work BEFORE
   *  hitting a 429, instead of only reacting after one (NFR-CUA-PERF-003). Never throws from this
   *  callback outward — a caller's throttle logic is its own concern. */
  onRateLimitInfo?: (info: ClickUpRateLimitHeaders) => void;
}

export interface ClickUpRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  priority?: ClickUpLanePriority;
}

function extractErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'err' in body && typeof (body as { err: unknown }).err === 'string') {
    return (body as { err: string }).err;
  }
  return `ClickUp request failed with status ${status}`;
}

/** Auto-retry is for IDEMPOTENT methods only (reads/updates/deletes). A POST create whose outcome is
 *  ambiguous — a 5xx after the server received the request, or a timeout after it was sent — may have
 *  been RECORDED, and ClickUp offers no idempotency key on task creation, so re-sending it would mint
 *  a duplicate external task. A create is therefore attempted EXACTLY ONCE and any failure surfaces as
 *  `external-unreachable` with an UNCONFIRMED outcome (the classified push copy already says so);
 *  resolving the ambiguity is a lookup (check what ClickUp holds), never a blind resend. */
function isIdempotentMethod(method: ClickUpRequestOptions['method']): boolean {
  return method !== 'POST';
}

const CREATE_UNCONFIRMED_SUFFIX =
  '; the create was attempted once and not retried — whether ClickUp recorded it is unconfirmed';

/**
 * Issues one rate-limited, retried ClickUp REST v2 request. Maps a `4xx` response to
 * `AdapterError('commit-rejected', <ClickUp message>)`; an exhausted-retry `429`/`5xx`/network
 * failure to `AdapterError('external-unreachable', ...)`. A `POST` create never auto-retries (see
 * `isIdempotentMethod`) — an ambiguous create failure reports the outcome as unconfirmed.
 */
export async function clickUpRequest(deps: ClickUpClientDeps, opts: ClickUpRequestOptions): Promise<unknown> {
  if (deps.rateLimiter) await deps.rateLimiter.acquire(opts.priority ?? 'bulk');

  const idempotent = isIdempotentMethod(opts.method);
  let res: Response;
  try {
    const attempt = () =>
      fetchOnce(
        deps.fetchImpl,
        `${deps.baseUrl ?? DEFAULT_BASE_URL}${opts.path}`,
        {
          method: opts.method,
          headers: { Authorization: deps.token, 'Content-Type': 'application/json' },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        },
        CLICKUP_REQUEST_TIMEOUT_MS,
      );
    res = idempotent ? await withBackoff(attempt) : await attempt();
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'ClickUp request failed';
    throw new ClickUpHttpError(0, 'external-unreachable', idempotent ? detail : `${detail}${CREATE_UNCONFIRMED_SUFFIX}`);
  }

  deps.onRateLimitInfo?.(readClickUpRateLimitHeaders(res));

  if (res.status === 429 || res.status >= 500) {
    throw new ClickUpHttpError(
      res.status,
      'external-unreachable',
      idempotent ? `ClickUp request failed with status ${res.status}` : `ClickUp request failed with status ${res.status}${CREATE_UNCONFIRMED_SUFFIX}`,
    );
  }

  const bodyText = res.status === 204 ? '' : await res.text();
  // SEC-MEDIUM-5: an error body is not guaranteed to be JSON (an HTML error page, an empty body, or a
  // plain-text upstream failure all reach here on a 404/4xx/5xx). A raw JSON.parse threw a SyntaxError
  // BEFORE the status-based classification below ever ran, so a non-JSON 404 crashed the whole request
  // instead of being recognised as a 404 (reads.ts's 404 -> "List/task not found" branch never saw it).
  // Defensive parse: fall back to `null` on a malformed body — every caller downstream branches on
  // `res.status`, never on the parsed body being present.
  let body: unknown = null;
  if (bodyText) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = null;
    }
  }

  if (res.status >= 400) {
    throw new ClickUpHttpError(res.status, 'commit-rejected', extractErrorMessage(body, res.status));
  }

  return body;
}
