/**
 * adapter-dispatch — Deno Edge Function entry point (ADR-0055 P0, FR-EAS-023/033/042).
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
 */

// Deno-native imports (not in pmo-portal/package.json)
import { createClient } from '@supabase/supabase-js';
import { dispatchExternallyOwnedWrite } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { recordExternalRef as recordExternalRefWrite } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { createReferenceAdapter, REFERENCE_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/referenceAdapter.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { AdapterCommand, PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';

// P0 adapter registry, keyed by the PMO domain the tier natively owns. 'reference' is the ONLY
// entry in P0 (ADR-0055 §"out of scope" — real ClickUp/ERPNext/Odoo adapters are P1+).
const ADAPTER_REGISTRY: Record<string, () => ReturnType<typeof createReferenceAdapter>> = {
  [REFERENCE_DOMAIN]: () => createReferenceAdapter('commit-success'),
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

  // ── 3. Adapter select (AC-EAS-033 step 2) — the P0 registry (only 'reference'). ──
  const adapterFactory = ADAPTER_REGISTRY[command.domain];
  if (!adapterFactory) {
    return new Response(
      JSON.stringify({ error: 'UNSUPPORTED_DOMAIN', message: `no adapter owns domain "${command.domain}"` }),
      { status: 400, headers },
    );
  }
  const adapter = adapterFactory();

  // service_role client — used ONLY for the machine-write helpers below (read-model upsert +
  // external_refs record). Never used for adapter.commit() — org_id never crosses into the
  // adapter (AC-EAS-023).
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  try {
    // ── 4/5/6. command invoke → read-model update → external_refs record → return
    // (AC-EAS-033 steps 3/4/5, in that exact order — enforced inside dispatchExternallyOwnedWrite). ──
    const result = await dispatchExternallyOwnedWrite({
      adapter,
      command,
      writeReadModel: async (canonical: PmoRecord) => {
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
