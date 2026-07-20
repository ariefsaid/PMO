/**
 * ClickUp REST v2 rate limiting (NFR-CUA-PERF-003, FR-CUA-090/091/092). Confined to clickup/**:
 * ClickUp's ~100 req/min budget and its `Retry-After` 429 convention are ClickUp-specific, never
 * surfaced above this module.
 */

export type ClickUpLanePriority = 'interactive' | 'bulk';

export interface ClickUpRateLimiterOptions {
  /** Requests allowed per rolling window (ClickUp's documented ~100/min budget). */
  capacity?: number;
  /** The rolling window, ms (default 60s). */
  windowMs?: number;
  now?: () => number;
}

interface QueuedAcquire {
  priority: ClickUpLanePriority;
  resolve: () => void;
}

/**
 * A rolling-window token bucket with an interactive-priority lane (NFR-CUA-PERF-003): an
 * `'interactive'` acquire is spliced ahead of any already-queued `'bulk'` acquire, so a live user
 * write submitted mid-bulk-batch is served before the batch's remaining queued tokens, without ever
 * exceeding the shared budget (the bucket itself is priority-blind — priority only reorders the
 * queue, never grants an extra token).
 */
export class ClickUpRateLimiter {
  private readonly capacity: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private grantedAt: number[] = [];
  private queue: QueuedAcquire[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: ClickUpRateLimiterOptions = {}) {
    this.capacity = opts.capacity ?? 100;
    this.windowMs = opts.windowMs ?? 60_000;
    this.now = opts.now ?? Date.now;
  }

  private availableSlots(): number {
    const cutoff = this.now() - this.windowMs;
    this.grantedAt = this.grantedAt.filter((t) => t > cutoff);
    return this.capacity - this.grantedAt.length;
  }

  /** Acquire one token; resolves once granted (immediately, if a slot is free). */
  acquire(priority: ClickUpLanePriority = 'bulk'): Promise<void> {
    return new Promise((resolve) => {
      if (priority === 'interactive') {
        const firstBulkIndex = this.queue.findIndex((q) => q.priority === 'bulk');
        if (firstBulkIndex === -1) this.queue.push({ priority, resolve });
        else this.queue.splice(firstBulkIndex, 0, { priority, resolve });
      } else {
        this.queue.push({ priority, resolve });
      }
      this.drain();
    });
  }

  private drain(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.queue.length > 0 && this.availableSlots() > 0) {
      const next = this.queue.shift();
      if (!next) break;
      this.grantedAt.push(this.now());
      next.resolve();
    }
    if (this.queue.length > 0 && this.grantedAt.length > 0) {
      const wait = Math.max(0, this.grantedAt[0] + this.windowMs - this.now());
      this.timer = setTimeout(() => this.drain(), wait);
    }
  }
}

export interface WithBackoffOptions {
  /** Bounded retry budget for 429/5xx responses (default 3). */
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock (default `Date.now`) — lets tests compute an `X-RateLimit-Reset` wait deterministically. */
  now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Parsed `X-RateLimit-*` headers ClickUp sends on every response (no `Retry-After` — ClickUp does not
 *  send that header at all; `X-RateLimit-Reset` is its only backoff signal on a 429). */
export interface ClickUpRateLimitHeaders {
  limit: number | null;
  remaining: number | null;
  /** Unix seconds when the current window resets. */
  reset: number | null;
}

/** Read `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` off a response. Any
 *  missing/non-numeric header parses to `null` (never throws — headers are advisory). */
export function readClickUpRateLimitHeaders(res: Response): ClickUpRateLimitHeaders {
  const num = (name: string): number | null => {
    const raw = res.headers.get(name);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  return { limit: num('X-RateLimit-Limit'), remaining: num('X-RateLimit-Remaining'), reset: num('X-RateLimit-Reset') };
}

/**
 * Retries a fetch on a transient response (429 or 5xx). Backoff precedence: `Retry-After` (kept for
 * any non-ClickUp caller that sends it) → ClickUp's `X-RateLimit-Reset` (unix seconds — ClickUp's ONLY
 * 429 backoff signal; it never sends `Retry-After`) → a linear fallback when neither header is present.
 * Bounded by `maxRetries` — an exhausted budget returns the last (still-failing) response as-is; the
 * caller (client.ts) classifies it as `external-unreachable` (a clean typed error, not a hang). Never
 * drops or duplicates the underlying call — `fn` is invoked exactly once per attempt.
 */
export async function withBackoff(
  fn: () => Promise<Response>,
  opts: WithBackoffOptions = {},
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? 3;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  let attempt = 0;
  for (;;) {
    const res = await fn();
    const transient = res.status === 429 || res.status >= 500;
    if (!transient || attempt >= maxRetries) return res;
    attempt += 1;
    const retryAfterHeader = res.headers.get('Retry-After');
    let waitMs: number;
    if (retryAfterHeader !== null) {
      waitMs = Number(retryAfterHeader) * 1000;
    } else {
      const { reset } = readClickUpRateLimitHeaders(res);
      waitMs = reset !== null ? Math.max(0, reset * 1000 - now()) : 500 * attempt;
    }
    await sleep(waitMs);
  }
}
