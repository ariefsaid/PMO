/**
 * requestRateGuard — per-caller REQUEST-frequency throttle for the public/expensive edge fns
 * (IG-audit 2026-07-10). DISTINCT from creditRateGuard (which bounds money/spend): this bounds how
 * OFTEN a caller may hit a function, defending function invocations + upstream model latency +
 * admin-invite email/user-row abuse. Backed by the fixed-window `rate_limit_hit()` RPC (migration
 * 0091), which returns TRUE while the caller is under the limit and FALSE once throttled.
 *
 * FAIL-OPEN (deliberate — the OPPOSITE of creditRateGuard's fail-closed): a request-rate limiter is
 * an AVAILABILITY defense, not a security boundary. If the limiter RPC errors, blocking legitimate
 * callers would turn a limiter glitch into a self-inflicted outage — worse than the burst it guards
 * against. RLS / can() / credits remain the real enforcement authority; this only smooths abusive
 * frequency. So on ANY RPC error or unexpected result, allow the request (exceeded:false).
 */

/** Minimal structural shape of the supabase-js client's `.rpc` for this guard (mirrors the
 *  HandlerSupabaseLike pattern in creditRateGuard — the real client is a structural superset). */
export interface RequestRateSupabaseLike {
  rpc(
    fn: 'rate_limit_hit',
    args: { p_key: string; p_limit: number; p_window_secs: number },
  ): Promise<{ data: unknown; error: unknown }>;
}

export interface RequestRateResult {
  /** true = the caller has exceeded `limit` requests in the current window; the fn should 429. */
  exceeded: boolean;
  /** Seconds the client should wait before retrying (the window length); 0 when not exceeded. */
  retryAfterSeconds: number;
}

/**
 * Record one request against `key` and report whether the caller is now over `limit` per
 * `windowSecs`. Fail-open on any error (see file header).
 */
export async function checkRequestRate(
  supabase: RequestRateSupabaseLike,
  opts: { key: string; limit: number; windowSecs: number },
): Promise<RequestRateResult> {
  const { key, limit, windowSecs } = opts;
  try {
    const { data, error } = await supabase.rpc('rate_limit_hit', {
      p_key: key,
      p_limit: limit,
      p_window_secs: windowSecs,
    });
    // Fail-open on error or a non-boolean result (limiter unavailable → don't block real traffic).
    if (error || typeof data !== 'boolean') {
      return { exceeded: false, retryAfterSeconds: 0 };
    }
    // rate_limit_hit returns TRUE while under the limit; FALSE means throttled.
    return data
      ? { exceeded: false, retryAfterSeconds: 0 }
      : { exceeded: true, retryAfterSeconds: windowSecs };
  } catch {
    return { exceeded: false, retryAfterSeconds: 0 };
  }
}
