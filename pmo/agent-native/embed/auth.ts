/**
 * Auth handoff — Step 4 coexistence pilot.
 *
 * Mints a Supabase access JWT via the OAuth2 password grant against local
 * Supabase (127.0.0.1:54321), then makes it visible to agent-native's client
 * so every same-origin `/_agent-native/*` call it issues carries
 * `Authorization: Bearer <jwt>` through the Vite dev proxy → Nitro sidecar.
 *
 * agent-native ships a built-in fetch interceptor for exactly this
 * (`ensureEmbedAuthFetchInterceptor`, exported from `@agent-native/core/client`,
 * verified in node_modules/.../embed-auth.d.ts). It monkey-patches `window.fetch`
 * so any same-origin request auto-injects `Authorization: Bearer <token>` plus
 * the `x-agent-native-embed-target` header. The token is resolved, in order,
 * from:  the `__an_embed_token` URL query param → an in-memory variable →
 * sessionStorage under key `agent-native:embed-auth-token`.
 *
 * We take the sessionStorage route (NOT the URL param): the URL param gets
 * stripped from the address bar by the interceptor and is awkward for a typed
 * sign-in form. `sessionStorage` survives reloads of this tab, which is all the
 * pilot needs. Writing the token to sessionStorage is sufficient because
 * `getEmbedAuthToken()` reads it on the next fetch.
 *
 * No real ANTHROPIC_API_KEY exists in this pilot, so the LLM loop will not
 * run — this module only proves the *embed + proxy + auth handoff*, i.e. that
 * the caller's JWT reaches the deputy middleware on the sidecar.
 */

import { ensureEmbedAuthFetchInterceptor } from "@agent-native/core/client";

/** sessionStorage key agent-native's interceptor reads (verified in embed-auth.js). */
const EMBED_TOKEN_STORAGE_KEY = "agent-native:embed-auth-token";

/**
 * Local Supabase config for the password grant.
 *
 * These mirror the sidecar's `.env` (gitignored). They are LOCAL-ONLY demo
 * values; the anon key is the well-known Supabase local-dev anon key. The
 * service_role key is NOT used here — only the password grant (anon-facing).
 */
const SUPABASE_URL =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ??
  "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

export interface SignInResult {
  /** The raw JWT to forward as `Bearer`. */
  accessToken: string;
  /** Caller email resolved by the grant. */
  email: string;
}

/**
 * Mint a JWT via the Supabase password grant.
 *
 * Uses the public anon key (never service_role) — this is exactly the path a
 * real PMO sign-in takes. Returns the access_token we forward to the sidecar.
 */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<SignInResult> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "<no body>");
    throw new Error(`Password grant failed (${res.status}): ${detail}`);
  }

  const body = (await res.json()) as { access_token: string; user?: { email?: string } };
  return { accessToken: body.access_token, email: body.user?.email ?? email };
}

/**
 * Publish the JWT where agent-native's fetch interceptor will pick it up, then
 * ensure that interceptor is installed.
 *
 * Order matters: write sessionStorage FIRST (so the first fetch the
 * interceptor observes after install already has the token), then install.
 */
export function activateEmbedAuth(token: string): void {
  try {
    sessionStorage.setItem(EMBED_TOKEN_STORAGE_KEY, token);
  } catch {
    // sessionStorage can be denied in some sandboxed contexts; the in-memory
    // fallback inside the interceptor still covers same-tab fetches once we
    // set the URL param — but for this top-level pilot tab sessionStorage is
    // expected to work.
  }
  ensureEmbedAuthFetchInterceptor();
}

/** Drop the token (sign-out). */
export function clearEmbedAuth(): void {
  try {
    sessionStorage.removeItem(EMBED_TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** True if a token is already stored from a prior sign-in this tab. */
export function hasStoredToken(): boolean {
  try {
    return Boolean(sessionStorage.getItem(EMBED_TOKEN_STORAGE_KEY));
  } catch {
    return false;
  }
}
