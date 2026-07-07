/**
 * admin-invite-user — Deno Edge Function entry point (S3, FR-INV-004/005, issuance only).
 *
 * Integration-only: this file is NOT unit-tested (mirrors compose-view/agent-dispatch — ADR-0039
 * decision 7 / the agent-dispatch precedent). All authorization logic lives in
 * pmo-portal/src/lib/invite/inviteHandler.ts (pure, importable in Vitest — see
 * inviteHandler.test.ts for the 11 authorization cases this wrapper delegates to).
 *
 * Responsibilities of this wrapper:
 *   1. Read the Authorization header; reject with 401 if absent.
 *   2. Verify the JWT using a caller-JWT-scoped client (`auth.getUser()`).
 *   3. Delegate to `authorizeInvite` (the caller-JWT client doubles as the InviteSupabaseLike —
 *      its `.rpc`/`.from` calls run under the CALLER's RLS, never service_role) — an unauthorized
 *      caller is rejected here, BEFORE any service-role call is ever made (FR-INV-004 SHALL: the
 *      service-role key is never exercised for an unauthorized caller).
 *   4. Only on successful authorization: build a service-role client and (a) issue the Supabase
 *      auth invite (`auth.admin.inviteUserByEmail`, with `redirectTo: <origin>/update-password` +
 *      `user_metadata.invite_pending = true` — the cross-issue contract with `auth-production-floor`,
 *      2026-07-04), and (b) insert the `profiles` row (org_id, role, status='active').
 *   5. Boundary: NO email body / SMTP / redirect page — `inviteUserByEmail` uses Supabase's
 *      default invite template; the accept flow (magic-link landing, password set) is the
 *      separate `auth-production-floor` spec.
 */

// Deno-native imports (not in pmo-portal/package.json)
import { createClient } from '@supabase/supabase-js';
import { authorizeInvite, InviteError } from '../../../pmo-portal/src/lib/invite/inviteHandler.ts';
import type { InviteSupabaseLike } from '../../../pmo-portal/src/lib/invite/inviteHandler.ts';
import { logStructuredError } from '../_shared/errorLog.ts';

function json(body: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  const corsHeaders = {
    // L5 (security review): fail-closed to SITE_URL when AGENT_ALLOWED_ORIGIN is unset (the loose
    // `*` default let a misconfigured prod silently accept any origin). Auth is Bearer-token so
    // browsers can't combine `*` with credentialed requests, but the explicit default is safer.
    'Access-Control-Allow-Origin': Deno.env.get('AGENT_ALLOWED_ORIGIN') ?? Deno.env.get('SITE_URL') ?? '',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // ── 1. Read and validate the Authorization header ──────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'UNAUTHORIZED' }, 401, corsHeaders);
  }
  const jwt = authHeader.slice(7); // strip "Bearer "

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    logStructuredError({ fn: 'admin-invite-user', errorCode: 'MISCONFIGURED' });
    return json({ error: 'MISCONFIGURED' }, 500, corsHeaders);
  }

  // ── 2. Caller-JWT-scoped client (deputy auth) — verify + authorize under it. ──
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData, error: userError } = await callerClient.auth.getUser(jwt);
  const uid = userData?.user?.id;
  if (userError || !uid) {
    return json({ error: 'UNAUTHORIZED' }, 401, corsHeaders);
  }

  let body: { email?: string; role?: string; p_org_id?: string | null };
  try {
    body = (await req.json()) as { email?: string; role?: string; p_org_id?: string | null };
  } catch {
    return json({ error: 'BAD_BODY' }, 400, corsHeaders);
  }

  // ── 3. Authorize (the caller-JWT client's .rpc/.from run under the caller's RLS — the
  // service-role client below is built ONLY after this succeeds). ──
  let authorized: { targetOrgId: string; role: string };
  try {
    authorized = await authorizeInvite(callerClient as unknown as InviteSupabaseLike, uid, {
      email: body.email ?? '',
      role: body.role ?? '',
      p_org_id: body.p_org_id ?? null,
    });
  } catch (err) {
    if (err instanceof InviteError) {
      return json({ error: err.code }, err.status, corsHeaders);
    }
    logStructuredError({ fn: 'admin-invite-user', errorCode: 'INVITE_AUTHORIZE_FAILED' });
    return json({ error: 'INVITE_FAILED' }, 500, corsHeaders);
  }

  // ── 4. Service-role issuance — ONLY reached for an authorized caller. ──
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const email = (body.email ?? '').trim();
  // M2 (security review): resolve the redirect origin from a SERVER-CONTROLLED source only — the
  // request `Origin` header is attacker-controllable, and redirectTo is a privilege-bearing URL
  // (the invitee sets their password there). Trusting Origin lets a compromised Operator craft an
  // invite whose link points at an attacker domain. SITE_URL is the deploy root; the GoTrue
  // redirect-URL allowlist (Supabase dashboard) is the second defense layer.
  const siteUrl = Deno.env.get('SITE_URL') ?? '';
  if (!siteUrl) {
    logStructuredError({ fn: 'admin-invite-user', errorCode: 'MISCONFIGURED_SITE_URL' });
    return json({ error: 'MISCONFIGURED' }, 500, corsHeaders);
  }

  const { data: invite, error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(email, {
    // Cross-issue contract (auth-production-floor, 2026-07-04): without redirectTo, GoTrue
    // resolves the invite link to the bare site_url and the invitee never reaches the
    // set-password page.
    redirectTo: `${siteUrl}/update-password`,
    data: { invite_pending: true },
  });
  if (inviteError || !invite?.user) {
    logStructuredError({ fn: 'admin-invite-user', errorCode: 'INVITE_ISSUE_FAILED' });
    return json({ error: 'INVITE_ISSUE_FAILED' }, 502, corsHeaders);
  }

  const { error: profileError } = await serviceClient.from('profiles').insert({
    id: invite.user.id,
    org_id: authorized.targetOrgId,
    role: authorized.role,
    status: 'active',
    email,
    full_name: '',
  });
  if (profileError) {
    logStructuredError({ fn: 'admin-invite-user', errorCode: 'PROFILE_CREATE_FAILED' });
    // Compensate (saga rollback): the invite above already created an auth.users row. Without a
    // matching profiles row it is orphaned — the email is now "taken" (a retry fails at invite
    // issuance) and the account can partially authenticate with no org/role. Delete the just-created
    // Auth user so the invite is atomic (all-or-nothing) and the email can be retried.
    const { error: cleanupError } = await serviceClient.auth.admin.deleteUser(invite.user.id);
    if (cleanupError) {
      // Best-effort — if cleanup ALSO fails, surface a distinct code so the orphan is
      // visible/alertable, not silently swallowed.
      logStructuredError({ fn: 'admin-invite-user', errorCode: 'PROFILE_CREATE_CLEANUP_FAILED' });
    }
    return json({ error: 'PROFILE_CREATE_FAILED' }, 502, corsHeaders);
  }

  return json({ ok: true }, 200, corsHeaders);
});
