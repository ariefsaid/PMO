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
import { getReadModelWriter } from './readModelWriters.ts';
import { maybeFault, type FaultGate } from './faultSeams.ts';

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

// NOTE (faultSeams.ts 'after-submit-before-mirror', FR-ENA-003): neither P0 (reference) nor P1
// (ClickUp) has a two-step insert-then-submit commit — `Adapter.commit()` is one call. This seam has
// no call site until the ERPNext money doctypes land their two-step submit (plan §2 decision 3,
// slice 2/6), at which point that adapter's own submit step calls `maybeFault('after-submit-before-
// mirror', faultGate)` directly (it is "surfaced via a dep the adapter calls", not wired here). The
// gate logic itself is already proven at the unit level (faultSeams.test.ts, task 0.6).

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

  // ── 1. org from JWT (AC-EAS-033 step 1). verify_jwt=true already validated the JWT at the
  // gateway; extract the bearer here so the deputy-auth org lookup below runs under the
  // CALLER's own identity (never service_role). ──
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED', message: 'missing Authorization header' }), {
      status: 401,
      headers,
    });
  }
  const jwt = authHeader.slice(7); // strip "Bearer "

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'MISCONFIGURED', message: 'missing Supabase configuration' }), {
      status: 500,
      headers,
    });
  }

  // Deputy auth: identity + org resolution runs under the CALLER's own JWT (RLS-scoped) — never
  // service_role (compose-view/handler.ts Recon #4 precedent).
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData?.user) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED', message: 'invalid JWT' }), {
      status: 401,
      headers,
    });
  }
  const userId = userData.user.id;

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

  // ── Named server-side fault seams (Slice 0 task 0.7, FR-ENA-003, plan §2 decision 5; host
  // allowlist added fix-round finding 5): read the gate ONCE per request and thread it through.
  // `maybeFault` re-checks ALL THREE conditions per named seam, so this is a pure no-op in every
  // deployed/non-test context (ERPNEXT_TEST_FAULTS unset, or ERPNEXT_TEST_FAULTS_ALLOW_HOST unset/
  // non-matching ⇒ byte-for-byte, zero behavior change for slice 0 — no org employs ERPNext yet).
  const faultGate: FaultGate = {
    envFaults: Deno.env.get('ERPNEXT_TEST_FAULTS'),
    header: req.headers.get('x-erpnext-test-fault'),
    requestHost: req.headers.get('x-forwarded-host') ?? req.headers.get('host'),
    allowedHosts: Deno.env.get('ERPNEXT_TEST_FAULTS_ALLOW_HOST'),
  };

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

  // Fault-seam-injected wrapper (short-circuit before/at commit, FR-ENA-003): 'unreachable' /
  // 'reject-validation' / 'timeout' fire here, before the real adapter.commit() ever runs — each a
  // no-op unless its header matches. Wrapping the adapter (not editing dispatch.ts) means the seam's
  // thrown AdapterError still passes through dispatchExternallyOwnedWrite's own AdapterError→AppError
  // classification unmodified, so that pure/unit-tested module (dispatch.test.ts) needs no changes.
  const dispatchAdapter: Adapter = {
    ...adapter,
    commit: async (cmd: AdapterCommand) => {
      await maybeFault('unreachable', faultGate);
      await maybeFault('reject-validation', faultGate);
      await maybeFault('timeout', faultGate);
      return adapter.commit(cmd);
    },
  };

  try {
    // ── 4/5/6. command invoke → read-model update → external_refs record → return
    // (AC-EAS-033 steps 3/4/5, in that exact order — enforced inside dispatchExternallyOwnedWrite). ──
    const result = await dispatchExternallyOwnedWrite({
      adapter: dispatchAdapter,
      command,
      // Multi-domain read-model writer registry (task 1.6) — replaces the inline if-chain. An
      // unknown domain throws (no silent skip); ClickUp's `tasks` writer is byte-for-byte moved.
      writeReadModel: async (canonical: PmoRecord) => {
        // Fault seam: between commit and mirror (FR-ENA-003) — a no-op unless armed. Runs before
        // the per-domain mirror write; commit has already returned (dispatch.ts's fixed order).
        await maybeFault('after-commit-before-mirror', faultGate);
        // Multi-domain read-model writer registry (task 1.6) — supersedes slice 0's inline
        // if-chain (its ClickUp/reference branches moved byte-for-byte into readModelWriters.ts).
        const writer = getReadModelWriter(command.domain);
        await writer.upsert({ serviceClient: serviceClient as never, orgId }, canonical, command);
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
      // never calls recordExternalRef on a delete). Routed through the same registry (task
      // 1.6) — only domains whose writer defines `tombstone` support the delete branch;
      // others don't wire this dep (an omitted callback = no-op via dispatch.ts's optional
      // chaining, though only `tasks` reaches delete today).
      tombstoneReadModel: getReadModelWriter(command.domain).tombstone
        ? (pmoRecordId: string) =>
            getReadModelWriter(command.domain).tombstone!({ serviceClient: serviceClient as never, orgId }, pmoRecordId)
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
