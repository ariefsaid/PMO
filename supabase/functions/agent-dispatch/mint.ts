/**
 * mint.ts — THE minting slice (ADR-0044 §3, NFR-AAN-SEC-001). [OPUS-IMPL]
 *
 * This is the single most security-sensitive surface in the agent tier. A background automation has
 * no live user and no live JWT; naively that tempts service_role execution, which BYPASSES RLS and
 * detonates the org_id tenancy seam. Instead the dispatcher mints a short-lived, owner-scoped JWT
 * for the automation's OWN owner and hands it to the standard deputy path, so RLS stays the ceiling
 * by construction (FR-AAN-016/017/018).
 *
 * Binding constraints (ADR-0044 §3, enforced here + by dispatcher.mint.test.ts's gate):
 *   1. service_role is used ONLY to mint (the Auth admin API) — never to query business data. The
 *      minted CLIENT (built from the minted token) is what the fired run uses.
 *   2. Minting is ONLY EVER for the owner_id of the specific automation row being dispatched. No
 *      request-supplied or model-supplied identity can influence it — this module reads owner_id
 *      off the automation row and nothing else.
 *   3. Every mint is audited (auditMint → an agent_events type='system' row on the fired run,
 *      BEFORE the minted client is used for anything else).
 *   4. The minted token is NEVER persisted or logged (NFR-AAN-SEC-008) — it is only ever handed to
 *      the in-memory client builder. Note (gpt-5.5 audit #4): the Supabase admin `generateLink`
 *      magiclink API exposes NO custom-TTL knob, so the minted JWT uses the project's DEFAULT OTP/JWT
 *      expiry — its cryptographic lifetime is NOT bounded to the automation's timeout_s. What IS
 *      bounded to timeout_s is the fired run's WALL-CLOCK deadline (the dispatcher's AbortController),
 *      returned below as `wallClockTimeoutS`. (ADR-0044 §3 item 3's "lifetime bounded to timeout_s"
 *      wording overstates the JWT bound and should be corrected — flagged for the Director in the PR.)
 *
 * Pure/injectable (REC-1): the Auth admin API and the caller-JWT client builder are injected, so
 * this compiles + unit-tests under Node/Vitest without Deno globals.
 */
import type { AutomationRow } from './dispatcher.ts';

/**
 * The minimal Supabase Auth admin surface this module needs. The dispatcher's index.ts constructs
 * the real one from the service-role key (`createClient(url, serviceRoleKey).auth`). service_role is
 * used HERE ONLY to call the admin API — never for a `.from()` business query.
 *
 * generateLink({ type: 'magiclink', email }) returns an action_link whose properties carry a
 * short-lived access token for the user. We resolve the user's email from owner_id via
 * admin.getUserById so the ONLY identity input to the mint is owner_id.
 */
export interface AuthAdminLike {
  admin: {
    getUserById?: (id: string) => PromiseLike<{ data: { user: { email?: string } | null } | null; error: unknown }>;
    // The real supabase-js `generateLink(params: GenerateLinkParams)` requires `email` on EVERY
    // magiclink variant — there is NO `user_id` form. So mintOwnerJwt resolves the owner's email
    // first and FAILS CLOSED if it cannot: magiclink is only ever called with `{ type:'magiclink',
    // email }`. (Previously a `{ type:'magiclink', user_id: ownerId }` fallback existed that matched
    // no real GenerateLinkParams member and failed opaquely — removed 2026-07-04.) `index.ts` bridges
    // the AuthAdminLike-vs-supabase-js shape with an explicit `as never` cast (this codebase's
    // established pattern for genuine structural gaps).
    generateLink: (params: Record<string, unknown>) => PromiseLike<{
      data: { properties?: { access_token?: string; hashed_token?: string } | null } | null;
      error: unknown;
    }>;
  };
}

export interface MintDeps {
  authAdmin: AuthAdminLike;
  /**
   * Builds a caller-JWT-scoped Supabase client from the minted access token — the SAME anon-key +
   * `Authorization: Bearer <token>` client shape the interactive path uses (index.ts wires the real
   * `createClient(url, anonKey, { global: { headers: { Authorization } } })`). Injected so this
   * module never persists/logs the token itself; it hands it straight to the builder.
   */
  buildClient: (accessToken: string) => unknown;
}

export interface MintedSession {
  /** The caller-JWT-scoped client the fired run executes under (RLS ceiling = owner). */
  client: unknown;
  /**
   * The automation's WALL-CLOCK fire deadline in seconds (== timeout_s) — the budget the dispatcher's
   * AbortController enforces on the fired run. NOT the minted JWT's cryptographic lifetime (gpt-5.5
   * audit #4: generateLink has no TTL knob; the JWT uses the project's default OTP/JWT expiry). The
   * minted token itself is never persisted.
   */
  wallClockTimeoutS: number;
}

/**
 * mintOwnerJwt — mint a short-lived, owner-scoped session for EXACTLY automation.owner_id
 * (AC-AAN-016, FR-AAN-016). The only identity input is `automation.owner_id`; no request- or
 * model-supplied id can reach the admin API. The minted access token is handed straight to the
 * injected client builder — never persisted, never logged (FR-AAN-018, NFR-AAN-SEC-008).
 */
export async function mintOwnerJwt(deps: MintDeps, automation: AutomationRow): Promise<MintedSession> {
  const ownerId = automation.owner_id;

  // Resolve the owner's email from owner_id (the ONLY identity input) so generateLink targets the
  // exact owner. magiclink REQUIRES email — the real Auth admin API has no user_id form — so an
  // unresolvable owner email is a FAIL-CLOSED mint error, never an invalid-param fallback that
  // fails opaquely against the real API. (Real users always have an email; a null here means a
  // genuinely email-less owner, which cannot authenticate anyway.)
  let email: string | undefined;
  if (deps.authAdmin.admin.getUserById) {
    const { data } = await deps.authAdmin.admin.getUserById(ownerId);
    email = data?.user?.email ?? undefined;
  }
  if (!email) {
    throw new Error('mint failed'); // scrubbed — fail-closed; never surface the owner id/email
  }

  const { data, error } = await deps.authAdmin.admin.generateLink({ type: 'magiclink', email });
  if (error || !data?.properties?.access_token) {
    throw new Error('mint failed'); // scrubbed — never surface the token/owner in the message
  }

  const accessToken = data.properties.access_token;
  const client = deps.buildClient(accessToken);

  return {
    client,
    wallClockTimeoutS: automation.timeout_s ?? 120,
  };
}

/** The minimal minted-client surface auditMint needs (agent_threads/agent_runs/agent_events writes). */
interface MintedClientLike {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => {
      select: () => { single: () => Promise<{ data: { id?: string } | null; error: unknown }> };
    };
  };
}

/**
 * auditMint — record the mint as an audit trail entry (FR-AAN-019, AC-AAN-017) and establish the
 * fired run, using the MINTED OWNER CLIENT (so owner RLS pins owner_id/org_id via column DEFAULT —
 * the audit row is the owner's own, FR-AAN-019). This is the FIRST use of the minted client and
 * MUST precede fireAutomation (AC-AAN-017: audited before the client is used for anything else).
 *
 * Because agent_events.run_id is NOT NULL (FK → agent_runs), the audit is written as the fired
 * run's first event: we create the thread + run row (owner RLS), then insert a type='system'
 * audit event on that run. fireAutomation then RESUMES this same runId, so exactly one ordinary
 * run exists per fire (FR-AAN-020) and the audit is its seq-0 system event.
 *
 * The audit payload carries automation_id / owner_id / minted_at ONLY — NEVER the minted JWT or a
 * refresh token (AC-AAN-020, NFR-AAN-SEC-008).
 */
export async function auditMint(
  mintedClient: unknown,
  automation: AutomationRow,
  runId: string,
  mintedAt: string,
): Promise<void> {
  const sb = mintedClient as MintedClientLike;

  // Create the fired run's thread + run (owner RLS stamps owner_id/org_id via DEFAULT). A failed
  // thread/run create means we cannot audit-on-run — surface it so the dispatcher does not fire an
  // unaudited run (fail-closed: no audit ⇒ no fire).
  const threadRes = await sb
    .from('agent_threads')
    .insert({ title: `Automation: ${automation.id}`, scope: null })
    .select()
    .single();
  if (threadRes.error || !threadRes.data?.id) {
    throw new Error('mint audit failed: thread');
  }
  const threadId = threadRes.data.id;

  const runRes = await sb
    .from('agent_runs')
    .insert({ id: runId, thread_id: threadId, title: `Automation: ${automation.id}`, status: 'running' })
    .select()
    .single();
  if (runRes.error) {
    throw new Error('mint audit failed: run');
  }

  // The audit event — automation_id / owner_id / minted_at ONLY. No token, ever (AC-AAN-020).
  const eventRes = await sb
    .from('agent_events')
    .insert({
      id: crypto.randomUUID(),
      run_id: runId,
      seq: 0,
      type: 'system',
      payload: {
        kind: 'automation_mint',
        automation_id: automation.id,
        owner_id: automation.owner_id,
        minted_at: mintedAt,
      },
    })
    .select()
    .single();
  if (eventRes.error) {
    throw new Error('mint audit failed: event');
  }
}
