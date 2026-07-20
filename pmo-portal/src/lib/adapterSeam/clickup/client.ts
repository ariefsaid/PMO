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

/**
 * Issues one rate-limited, retried ClickUp REST v2 request. Maps a `4xx` response to
 * `AdapterError('commit-rejected', <ClickUp message>)`; an exhausted-retry `429`/`5xx`/network
 * failure to `AdapterError('external-unreachable', ...)`.
 */
export async function clickUpRequest(deps: ClickUpClientDeps, opts: ClickUpRequestOptions): Promise<unknown> {
  if (deps.rateLimiter) await deps.rateLimiter.acquire(opts.priority ?? 'bulk');

  let res: Response;
  try {
    res = await withBackoff(() =>
      deps.fetchImpl(`${deps.baseUrl ?? DEFAULT_BASE_URL}${opts.path}`, {
        method: opts.method,
        headers: { Authorization: deps.token, 'Content-Type': 'application/json' },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      }),
    );
  } catch (err) {
    throw new ClickUpHttpError(0, 'external-unreachable', err instanceof Error ? err.message : 'ClickUp request failed');
  }

  deps.onRateLimitInfo?.(readClickUpRateLimitHeaders(res));

  if (res.status === 429 || res.status >= 500) {
    throw new ClickUpHttpError(res.status, 'external-unreachable', `ClickUp request failed with status ${res.status}`);
  }

  const bodyText = res.status === 204 ? '' : await res.text();
  const body: unknown = bodyText ? JSON.parse(bodyText) : null;

  if (res.status >= 400) {
    throw new ClickUpHttpError(res.status, 'commit-rejected', extractErrorMessage(body, res.status));
  }

  return body;
}
