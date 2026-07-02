/**
 * E3 (ADR-0040, FR-408 / AC-408) — bearer handoff from the PMO Supabase session to the
 * agent-native embed.
 *
 * agent-native ships a built-in fetch interceptor (`ensureEmbedAuthFetchInterceptor`,
 * exported from `@agent-native/core/client`, verified in
 * `node_modules/@agent-native/core/dist/client/embed-auth.d.ts`) that monkey-patches
 * `window.fetch` so same-origin requests auto-inject `Authorization: Bearer <token>`. The
 * token is resolved from `sessionStorage` under the SDK-owned key `agent-native:embed-auth-token`
 * (verified in `embed-auth.js`). Writing the PMO session JWT there + ensuring the interceptor
 * is installed is the WHOLE handoff — every same-origin `/_agent-native/*` call the panel makes
 * is then auto-authorized through the Vite proxy → Nitro sidecar.
 *
 * The interceptor is idempotent (`if (installed) return;`), so calling it once per token refresh
 * is safe.
 *
 * BUNDLE DISCIPLINE: the interceptor is fetched via DYNAMIC `import('@agent-native/core/client')`
 * so the ~730 kB client chunk is NEVER pulled into the default (flag-off) bundle — it loads only
 * when the embed is actually activated. `embedAuth.ts` itself has zero static agent-native imports.
 */

/** sessionStorage key the SDK interceptor reads (verified in embed-auth.js). */
export const EMBED_TOKEN_STORAGE_KEY = 'agent-native:embed-auth-token';

/**
 * Publish the PMO session JWT where agent-native's fetch interceptor picks it up, then
 * ensure that interceptor is installed.
 *
 * Order matters: write sessionStorage FIRST (so the first fetch the interceptor observes
 * after install already resolves the token), then install.
 *
 * No-op when no token is available (e.g. signed out) — clears any stale token instead.
 */
export async function activateEmbedAuth(accessToken: string | null | undefined): Promise<void> {
  if (!accessToken) {
    clearEmbedAuth();
    return;
  }
  try {
    sessionStorage.setItem(EMBED_TOKEN_STORAGE_KEY, accessToken);
  } catch {
    // sessionStorage can be denied in sandboxed/private contexts; the in-memory + URL-param
    // fallbacks inside the interceptor still cover same-tab fetches. Never throw on auth setup.
  }
  const { ensureEmbedAuthFetchInterceptor } = await import('@agent-native/core/client');
  ensureEmbedAuthFetchInterceptor();
}

/** Drop the token (sign-out / embed teardown). Does not uninstall the interceptor (idempotent no-op). */
// M-6: the fetch interceptor is INTENTIONALLY left installed after sign-out /
// teardown. It is token-gated — once the sessionStorage token above is gone it
// resolves no Bearer and becomes a harmless no-op for same-origin fetches.
// Uninstalling a `window.fetch` monkey-patch mid-flight is unsafe (in-progress
// requests hold the patched ref) and unnecessary. Do NOT "fix" this by
// restoring the original fetch here.
export function clearEmbedAuth(): void {
  try {
    sessionStorage.removeItem(EMBED_TOKEN_STORAGE_KEY);
  } catch {
    // ignore — nothing to clear
  }
}

/** True if a token is already stored from a prior activation this tab. */
export function hasStoredEmbedToken(): boolean {
  try {
    return Boolean(sessionStorage.getItem(EMBED_TOKEN_STORAGE_KEY));
  } catch {
    return false;
  }
}
