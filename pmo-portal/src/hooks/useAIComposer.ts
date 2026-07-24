/**
 * useAIComposer — client hook for the compose-view edge function.
 *
 * Responsibilities:
 * - POST to /functions/v1/compose-view with the caller's session JWT (FR-AS-016, NFR-AS-SEC-006)
 * - orgId sourced from currentUser.org_id (Reconciliation #4 — NOT app_metadata)
 * - Defense-in-depth: re-runs compileCompositionSpec on server response before returning spec
 *   (FR-AS-017, FR-AS-022, Reconciliation #1 — throws; AC-AS-019)
 * - Maps status codes to user-facing error messages (FR-AS-018, FR-AS-019)
 *
 * ADR-0039 decision 2 (deputy auth): hook forwards only the user's own JWT, never constructs
 * or elevates claims (NFR-AS-SEC-006).
 */
import { useState } from 'react';
import { useAuth } from '@/src/auth/useAuth';
import { compileCompositionSpec } from '@/src/lib/viewspec/compiler';
import type { CompositionSpec } from '@/src/lib/viewspec/types';

/** Bound the compose-view request — a model round-trip can be legitimately slow, but must never hang
 *  the composer on 'loading' forever. Generous enough for a real generation, short enough to recover. */
const COMPOSE_TIMEOUT_MS = 30_000;

export type AIComposerStatus = 'idle' | 'loading' | 'error';

export interface UseAIComposerResult {
  compose: (prompt: string) => Promise<CompositionSpec | null>;
  status: AIComposerStatus;
  error: string | null;
}

/** Map server error codes to user-facing messages (FR-AS-018, FR-AS-019). */
function mapError(status: number, _body: unknown): string {
  if (status === 422) {
    return "Couldn't generate a valid view for that description. Try rephrasing or being more specific.";
  }
  if (status === 429) {
    return "You've reached the AI compose limit. Try again later.";
  }
  if (status === 401) {
    return 'Authentication required. Please sign in again.';
  }
  // 502 or other
  return 'AI compose is temporarily unavailable. Please try again later.';
}

export function useAIComposer(): UseAIComposerResult {
  const { currentUser, session } = useAuth();
  const [status, setStatus] = useState<AIComposerStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const compose = async (prompt: string): Promise<CompositionSpec | null> => {
    // Set loading synchronously before any await (NFR-AS-PERF-002: < 200ms)
    setStatus('loading');
    setError(null);

    // Bound the request: a hung compose-view (edge fn reachable, upstream model slow/down) would
    // otherwise leave the composer stuck on 'loading' forever. AbortController + a timer fail fast;
    // the catch below maps the AbortError to the same generic "temporarily unavailable" state.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), COMPOSE_TIMEOUT_MS);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const url = `${supabaseUrl}/functions/v1/compose-view`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Forward only the user's own JWT (NFR-AS-SEC-006, Recon #4)
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          prompt,
          // orgId from currentUser (profiles row), NOT from JWT app_metadata (Recon #4)
          orgId: currentUser?.org_id,
        }),
        signal: controller.signal,
      });

      const body = await res.json();

      if (!res.ok) {
        const msg = mapError(res.status, body);
        setError(msg);
        setStatus('error');
        return null;
      }

      // Server returned 200 — defense-in-depth client-side re-validation
      // (FR-AS-017, FR-AS-022, ADR-0039 decision 3, Reconciliation #1 — throws on invalid)
      const spec = body.spec as CompositionSpec;
      try {
        compileCompositionSpec(spec, {
          userId: currentUser?.id ?? '',
          orgId: currentUser?.org_id ?? '',
        });
      } catch {
        // Tampered or corrupt spec — should not happen in normal operation
        setError("The composed view failed client-side validation. Try rephrasing.");
        setStatus('error');
        return null;
      }

      setStatus('idle');
      return spec;
    } catch {
      // Includes the AbortError thrown when the timeout fires — surfaced as the same generic
      // "temporarily unavailable" state (no raw error string, no stuck 'loading').
      setError('AI compose is temporarily unavailable. Please try again later.');
      setStatus('error');
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  return { compose, status, error };
}
