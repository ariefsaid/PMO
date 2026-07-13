/**
 * adapter-dispatch — Deno Edge Function entry point (ADR-0055 P0/P1, FR-EAS-023/033/042, FR-CUA-001).
 *
 * Thin wiring ONLY — the ordered write-through orchestration lives in the pure
 * `dispatchExternallyOwnedWrite` (pmo-portal/src/lib/adapterSeam/dispatch.ts), unit-tested under
 * dispatch.test.ts. This file is INTEGRATION-ONLY (not unit-tested) — verified by `deno check` +
 * the boot-smoke (the same contract as agent-dispatch/compose-view, ADR-0039/0044).
 *
 * Order (AC-EAS-033): org from JWT → adapter select → command invoke (NO org_id, AC-EAS-023) →
 * read-model update (service role) → external_refs record → return.
 *
 * `verify_jwt = true` (supabase/config.toml): the Supabase gateway already rejects an invalid/
 * missing JWT before this handler runs. The handler still resolves the CALLER's identity + org
 * itself — via a caller-JWT-scoped client (deputy auth, NOT service_role), the same
 * profiles-lookup-under-RLS pattern as compose-view/handler.ts Recon #4 — because the adapter
 * must NEVER receive org_id (FR-EAS-024): org context is bound HERE, above the adapter, and used
 * only for the machine-write helpers (read-model upsert + external_refs record), never passed
 * into `adapter.commit()`.
 *
 * P1 (ClickUp, Slice B): the `tasks` domain resolves its per-project external container binding +
 * status/member maps from `external_project_bindings` (service role) at request time, so its factory is async and
 * receives the caller's org + the parsed command — unlike the P0 `reference` factory (no args). The
 * `writeReadModel` helper below branches per `command.domain`: `tasks` upserts/updates the `tasks`
 * read-model row directly (mirroring ClickUp's completion date, FR-CUA-030 Finding 6); every other
 * domain keeps the P0 `external_reference_items` behavior byte-for-byte.
 */

// Deno-native imports (not in pmo-portal/package.json)
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { dispatchExternallyOwnedWrite } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { recordExternalRef as recordExternalRefWrite } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { createReferenceAdapter, REFERENCE_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/referenceAdapter.ts';
import { CLICKUP_TASKS_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/clickup/adapter.ts';
import { resolveClickUpDispatchAdapter } from '../../../pmo-portal/src/lib/adapterSeam/clickup/dispatchFactory.ts';
import { ClickUpRateLimiter } from '../../../pmo-portal/src/lib/adapterSeam/clickup/rateLimit.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { Adapter, AdapterCommand, PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import {
  verifyCallerJwt,
  bearerToken,
  JwtVerifyError,
  jwksFromUrl,
  type JwksResolver,
} from '../../../pmo-portal/src/lib/auth/verifyCallerJwt.ts';

// ADR-0057: one cached, rate-limited JWKS resolver, memoized across warm invocations. Built lazily
// so an empty SUPABASE_URL can't throw a URL error before the handler can return a typed 401/500.
let _jwks: JwksResolver | null = null;
function getJwks(supabaseUrl: string): JwksResolver {
  if (!_jwks) _jwks = jwksFromUrl(`${supabaseUrl}/auth/v1/.well-known/jwks.json`);
  return _jwks;
}

/** The adapter-select context: the caller's org, the parsed command, and the service-role client for
 * per-request config lookups (project binding, external_refs resolution). Never used for adapter.commit(). */
interface AdapterSelectContext {
  orgId: string;
  command: AdapterCommand;
  serviceClient: SupabaseClient;
}

type AdapterFactory = (ctx: AdapterSelectContext) => Promise<Adapter>;

// Shared across invocations of this isolate (module scope) — the token bucket's budget is real
// only if it persists across requests, not recreated per-call (NFR-CUA-PERF-003).
const clickUpRateLimiter = new ClickUpRateLimiter();

// ClickUp adapter factory (review fix #9): all ClickUp config/member resolution lives OPAQUELY in the
// pure `clickup/dispatchFactory.ts` — this dispatcher passes the caller's org + command + an injected
// service-client seam + ClickUp client deps and never sees ClickUp vocabulary (confinement, FR-CUA-012).
function resolveClickUpAdapter(ctx: AdapterSelectContext): Promise<Adapter> {
  return resolveClickUpDispatchAdapter({
    // The real supabase-js client structurally satisfies the factory's DispatchServiceClient seam at
    // runtime but is not nominally assignable (thenable PostgrestFilterBuilder); same cast idiom as the
    // machine-write helpers below.
    serviceClient: ctx.serviceClient as never,
    orgId: ctx.orgId,
    command: ctx.command,
    fetchImpl: fetch,
    token: Deno.env.get('CLICKUP_API_TOKEN') ?? '',
    baseUrl: Deno.env.get('CLICKUP_API_BASE_URL') ?? undefined,
    rateLimiter: clickUpRateLimiter,
  });
}

// Adapter registry, keyed by the PMO domain the tier natively owns. 'reference' is the P0 synthetic
// domain (ADR-0055 §"out of scope"); 'tasks' is ClickUp's P1 domain (ADR-0055 P1, FR-CUA-001).
const ADAPTER_REGISTRY: Record<string, AdapterFactory> = {
  [REFERENCE_DOMAIN]: async () => createReferenceAdapter('commit-success'),
  [CLICKUP_TASKS_DOMAIN]: resolveClickUpAdapter,
};

// Same origin-narrowing seam as agent-chat/compose-view (AUDIT quick-win 2026-07-07): set
// AGENT_ALLOWED_ORIGIN in prod; falls back to SITE_URL, then '' (fail-closed — never '*').
function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': Deno.env.get('AGENT_ALLOWED_ORIGIN') ?? Deno.env.get('SITE_URL') ?? '',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const headers = { ...corsHeaders(), 'Content-Type': 'application/json' };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() });
  }

  // ── 1. org from JWT (AC-EAS-033 step 1). Read the bearer (case-insensitive, shared parser). ──
  const jwt = bearerToken(req.headers.get('Authorization'));
  if (!jwt) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED', message: 'missing Authorization header' }), {
      status: 401,
      headers,
    });
  }

  // Normalize a trailing slash so the derived issuer / JWKS URL never doubles a slash.
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'MISCONFIGURED', message: 'missing Supabase configuration' }), {
      status: 500,
      headers,
    });
  }

  // Verify the caller JWT LOCALLY against the project JWKS (ADR-0057 — asymmetric ES256), replacing
  // the auth.getUser round-trip with a cached, local signature check to resolve the caller's `sub`.
  // verify_jwt=true still pre-filters invalid tokens at the gateway (defense in depth); this extracts
  // the verified user id without a second GoTrue call. Any signature/expiry/issuer/audience/alg
  // failure → a single typed 401. The active-member (ban/disable) check that auth.getUser used to
  // provide is NOT lost — it lives in the RLS gating the org lookup below (see that comment).
  let userId: string;
  try {
    const verified = await verifyCallerJwt(jwt, getJwks(supabaseUrl), {
      issuer: Deno.env.get('SUPABASE_JWT_ISSUER') ?? `${supabaseUrl}/auth/v1`,
      audience: 'authenticated',
      algorithms: ['ES256'],
    });
    userId = verified.sub;
  } catch (err) {
    const status = err instanceof JwtVerifyError ? err.status : 401;
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED', message: 'invalid JWT' }), { status, headers });
  }

  // Deputy auth: org resolution runs under the CALLER's own JWT (RLS-scoped) — never service_role
  // (compose-view/handler.ts Recon #4 precedent). This RLS read is ALSO the active-member gate that
  // keeps dropping auth.getUser safe on this service_role / destructive path: profiles_select is
  // conjoined with is_active_member() (status='active', mig 0063 applies it to EVERY business-table
  // policy), so a disabled/offboarded caller (admin_set_user_status sets status='disabled', mig 0065)
  // resolves ZERO rows here → the `!profile` branch returns 400 and NO service_role write ever runs.
  // The active-member check thus lives in the RLS gating this lookup, not in getUser — consistent with
  // the app-wide is_active_member standard. (Verified empirically 2026-07-13: a disabled user's own
  // profile read returns []. Task-3 audit note: a raw dashboard `banned_until`-only ban that leaves
  // status='active' is outside the app-wide is_active_member model — an accepted app-wide posture, not
  // a gap unique to this function.)
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const { data: profile, error: profileError } = await callerClient
    .from('profiles')
    .select('org_id')
    .eq('id', userId)
    .single();
  if (profileError || !profile) {
    return new Response(JSON.stringify({ error: 'BAD_REQUEST', message: 'org not resolvable for caller' }), {
      status: 400,
      headers,
    });
  }
  const orgId = (profile as { org_id: string }).org_id;

  // ── 2. Parse the command body (PMO domain language; NEVER org_id — AC-EAS-023 proof surface). ──
  let command: AdapterCommand;
  try {
    command = (await req.json()) as AdapterCommand;
  } catch {
    return new Response(JSON.stringify({ error: 'BAD_REQUEST', message: 'invalid JSON body' }), {
      status: 400,
      headers,
    });
  }
  if (!command?.domain || !command?.operation || !command?.record?.id) {
    return new Response(
      JSON.stringify({ error: 'BAD_REQUEST', message: 'domain, operation, and record.id are required' }),
      { status: 400, headers },
    );
  }

  // service_role client — used for the machine-write helpers (read-model upsert/update + external_refs
  // record) AND, for 'tasks', to resolve the per-request ClickUp binding/mapping at adapter-select time.
  // Never used for adapter.commit() — org_id never crosses into the adapter (AC-EAS-023).
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  // ── 3. Adapter select (AC-EAS-033 step 2). ──
  const adapterFactory = ADAPTER_REGISTRY[command.domain];
  if (!adapterFactory) {
    return new Response(
      JSON.stringify({ error: 'UNSUPPORTED_DOMAIN', message: `no adapter owns domain "${command.domain}"` }),
      { status: 400, headers },
    );
  }

  let adapter: Adapter;
  try {
    adapter = await adapterFactory({ orgId, command, serviceClient });
  } catch (err) {
    const appError = err instanceof AppError ? err : new AppError(err instanceof Error ? err.message : 'adapter select failed');
    return new Response(JSON.stringify({ error: appError.code ?? 'ADAPTER_SELECT_FAILED', message: appError.message }), {
      status: 400,
      headers,
    });
  }

  try {
    // ── 4/5/6. command invoke → read-model update → external_refs record → return
    // (AC-EAS-033 steps 3/4/5, in that exact order — enforced inside dispatchExternallyOwnedWrite). ──
    const result = await dispatchExternallyOwnedWrite({
      adapter,
      command,
      writeReadModel: async (canonical: PmoRecord) => {
        if (command.domain === CLICKUP_TASKS_DOMAIN) {
          // P1: the tasks read-model row lives in `tasks` itself, not `external_reference_items`.
          const patch = {
            name: canonical.name,
            status: canonical.status,
            assignee_id: canonical.assignee_id ?? null,
            start_date: canonical.start_date ?? null,
            end_date: canonical.end_date ?? null,
            completed_at: (canonical.completed_at as string | null | undefined) ?? null,
            source_updated_at: new Date().toISOString(),
          };
          if (command.operation === 'create') {
            const projectId = (command.record as { project_id?: string }).project_id;
            if (!projectId) throw new AppError('project_id is required to mirror a created task', 'BAD_REQUEST');
            const { error } = await serviceClient
              .from('tasks')
              .insert({ id: canonical.id, org_id: orgId, project_id: projectId, ...patch });
            if (error) throw new AppError(error.message, error.code);
            return;
          }
          const { error } = await serviceClient.from('tasks').update(patch).eq('org_id', orgId).eq('id', canonical.id);
          if (error) throw new AppError(error.message, error.code);
          return;
        }
        // P0: reference read-model only.
        const { error } = await serviceClient
          .from('external_reference_items')
          .upsert(
            { org_id: orgId, pmo_record_id: canonical.id, payload: canonical },
            { onConflict: 'org_id,pmo_record_id' },
          );
        if (error) throw new AppError(error.message, error.code);
      },
      // Cast: the real supabase-js client's .from().upsert() returns a thenable
      // PostgrestFilterBuilder, not a plain Promise — structurally satisfies
      // ServiceRoleTableClient at runtime but is not nominally assignable (same
      // documented cast pattern as agent-dispatch/index.ts).
      recordExternalRef: (mapping) =>
        recordExternalRefWrite(serviceClient as never, { ...mapping, orgId }),
      // Delete-aware dispatch (Slice C, AC-CUA-038, FR-CUA-026): a ClickUp-native delete
      // tombstones the mirrored `tasks` row (OD-CUA-2) — dependency/milestone rows are
      // preserved (no cascade), and the external_refs mapping is kept as-is (dispatch.ts
      // never calls recordExternalRef on a delete). Only the `tasks` domain has a mirror
      // to tombstone; other P1 domains don't wire this dep (an omitted callback = no-op
      // handled by dispatch.ts's optional chaining, though only `tasks` reaches delete today).
      tombstoneReadModel:
        command.domain === CLICKUP_TASKS_DOMAIN
          ? async (pmoRecordId: string) => {
              const { error } = await serviceClient
                .from('tasks')
                .update({ tombstoned_at: new Date().toISOString() })
                .eq('org_id', orgId)
                .eq('id', pmoRecordId);
              if (error) throw new AppError(error.message, error.code);
            }
          : undefined,
    });
    return new Response(JSON.stringify(result), { status: 200, headers });
  } catch (err) {
    const appError = err instanceof AppError ? err : new AppError(err instanceof Error ? err.message : 'adapter dispatch failed');
    const status = appError.code === 'external-unreachable' ? 502 : appError.code === 'commit-rejected' ? 422 : 500;
    return new Response(JSON.stringify({ error: appError.code ?? 'DISPATCH_FAILED', message: appError.message }), {
      status,
      headers,
    });
  }
});
