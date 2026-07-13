/**
 * rejectionMessage — extracts a real diagnostic message from ANY `unhandledrejection`
 * `reason`, not just an `Error` instance.
 *
 * Root cause (live PostHog, 2026-07-13): `AnalyticsProvider`'s `unhandledrejection`
 * handler did `reason instanceof Error ? reason.message : String(reason)` — a rejected
 * Supabase `PostgrestError` (a plain object, never an `Error`) stringifies to the
 * literal `"[object Object]"`, so 10 captured exceptions carried zero diagnostic
 * content. This helper tries, in order: `.message`, `.error_description`, `.error`
 * (the shapes Supabase/PostgREST/OAuth error objects actually use), a plain string,
 * then falls back to a bounded JSON stringification — never `String(reason)` on an
 * object. `client.ts`'s `before_send` redaction still runs on whatever this returns
 * (this helper is NOT a PII scrub, just a "don't lose the diagnostic" fix).
 */
export function rejectionMessage(reason: unknown): string {
  if (reason == null) return 'UnhandledRejection';
  if (typeof reason === 'string') return reason;
  if (reason instanceof Error) return reason.message;

  if (typeof reason === 'object') {
    const obj = reason as Record<string, unknown>;
    const candidate = obj.message ?? obj.error_description ?? obj.error;
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
    try {
      return JSON.stringify(reason);
    } catch {
      // Circular or otherwise non-serializable — never throw out of an error handler.
      return 'UnhandledRejection';
    }
  }

  return String(reason);
}
