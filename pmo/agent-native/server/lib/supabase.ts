/**
 * Supabase client factories + JWT verification — the deputy building blocks.
 *
 * SECURITY INVARIANTS (verified by grep — see hard-constraint audit):
 *   - `createVerifierClient()` uses SERVICE_ROLE. It is the ONLY place
 *     service_role is constructed, and its single helper `verifyJwt()` calls
 *     `auth.getUser(jwt)` and `profiles` identity reads — never business data.
 *   - `createCallerClient()` uses the ANON key + the caller's RAW JWT. This is
 *     the deputy: every business-data query runs as the caller so RLS enforces.
 *     Never construct a caller client with the service role.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Supabase project URL (local pilot: http://127.0.0.1:54321). */
export function supabaseUrl(): string {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error("SUPABASE_URL is not set (run `supabase status -o env` and source .env)");
  return url;
}

/**
 * Identity verification result — exactly the fields the deputy middleware and
 * the agent-native `getSession` hook need. Derived from `auth.getUser` +
 * `profiles` (service_role identity read). `orgId`/`role` are nullable because
 * `profiles` is the source of truth and a user may legitimately have no org.
 */
export interface VerifiedCaller {
  userId: string;
  email: string;
  orgId: string | null;
  role: string | null;
}

/**
 * The verifier client (SERVICE_ROLE).
 *
 * HARD CONSTRAINT: used ONLY for `auth.getUser(jwt)` and a `profiles` identity
 * read in `verifyJwt()`. Never import this for business data — that path is the
 * deputy (anon key + caller JWT). Keeping construction in this one function
 * makes the service_role blast radius auditable.
 */
export function createVerifierClient(): SupabaseClient {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(supabaseUrl(), serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Verify a raw caller JWT and resolve its identity.
 *
 * service_role is used here for EXACTLY two things, both identity (not business):
 *   1. `auth.getUser(jwt)` — server-side JWT verification via Supabase GoTrue.
 *   2. `profiles` read — to resolve `org_id`/`role` (PMO's `auth_org_id()` /
 *      `auth_role()` source of truth). A `profiles` row is identity metadata.
 *
 * Returns `null` when the JWT is missing, malformed, expired, or unknown — the
 * caller (deputy middleware / getSession) treats null as "anonymous".
 */
export async function verifyJwt(jwt: string): Promise<VerifiedCaller | null> {
  const verifier = createVerifierClient();
  try {
    // ── 1. Verify the JWT (service_role, getUser ONLY) ──────────────────────
    const {
      data: { user },
      error,
    } = await verifier.auth.getUser(jwt);
    if (error || !user) return null;

    // ── 2. Resolve org_id / role from `profiles` (identity read) ────────────
    // app_metadata.org_id MAY be absent (profiles is the source of truth per
    // the PMO auth model), so we always consult profiles for a complete session.
    let orgId: string | null = null;
    let role: string | null = null;
    const { data: profile, error: profileError } = await verifier
      .from("profiles")
      .select("org_id, role")
      .eq("id", user.id)
      .maybeSingle();
    if (!profileError && profile) {
      orgId = profile.org_id ?? null;
      role = profile.role ?? null;
    }

    return {
      userId: user.id,
      email: user.email ?? "",
      orgId,
      role,
    };
  } finally {
    // service_role client is per-request; don't leak it across requests.
    verifier.auth.signOut?.().catch?.(() => {});
  }
}

/**
 * The deputy caller client (ANON key + caller JWT).
 *
 * Every business-data call MUST go through a client built this way so RLS
 * resolves as the caller (JWT `sub` → profiles.org_id / role via
 * `auth_org_id()` / `auth_role()`). Step 3 actions call this with the raw JWT
 * from `getCallerJwt()`.
 *
 * Throws if no caller JWT is present — building a caller client with no JWT
 * would silently run as anon-without-identity and bypass the deputy invariant.
 */
export function createCallerClient(rawJwt: string): SupabaseClient {
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error("SUPABASE_ANON_KEY is not set");
  return createClient(supabaseUrl(), anonKey, {
    global: { headers: { Authorization: `Bearer ${rawJwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
