/**
 * clickup-webhook — Deno Edge Function entry point (Slice D, FR-CUA-040/041/043, AC-CUA-040..045).
 *
 * The public, unauthenticated ClickUp webhook ingress. The `X-Signature` HMAC-SHA256 of the raw body
 * (keyed by CLICKUP_WEBHOOK_SECRET) is the SOLE trust boundary (FR-CUA-041, NFR-CUA-SEC-002): an
 * absent/invalid signature ⇒ 401 with NO side effect, before any read-model apply (STRIDE spoofing/
 * tampering). `verify_jwt = false` (supabase/config.toml) — the HMAC replaces the JWT gate.
 *
 * Thin wiring ONLY — the apply engine (signature-gated no-side-effect, per-row source-mod guard,
 * adopt-under-concurrency, idempotency, tombstone) is unit-tested under signature.test.ts /
 * webhookApply.test.ts / deletion.test.ts. This file is INTEGRATION-ONLY (not unit-tested) — verified
 * by `deno check` + the boot-smoke (same contract as adapter-dispatch/clickup-onboard, ADR-0039/0044).
 *
 * Org/project resolution (P1: single employing org per deployment — one CLICKUP_WEBHOOK_SECRET per
 * client, per the secrets section of the plan): resolve the `external_project_bindings` row for the
 * task — via the payload `list_id` (adopt path) or via `external_refs` → the task row's project
 * (mapped path) — to bind org + project + status/member maps ABOVE the pure apply (FR-EAS-024). If no
 * binding resolves, the event is ack'd (200) and skipped — the sweep is the safety net (FR-CUA-045).
 *
 * Phase 1b (task 1.7): Per-org Vault webhook secret behind EXTERNAL_CONNECT_ENABLED flag.
 * When flag is ON: resolve binding first, then use per-org webhook_secret_ref from Vault.
 * When flag is OFF (default): use global CLICKUP_WEBHOOK_SECRET (legacy behavior unchanged).
 *
 * PROVISIONAL wire shape (the exact ClickUp webhook envelope — `event`/`task_id`/`list_id`/`task` — is
 * re-verified in the deferred live-smoke appendix, same stance as mapping.ts; mocked-only in P1).
 */

// Deno-native imports (not in pmo-portal/package.json)
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { verifyClickUpSignature } from '../../../pmo-portal/src/lib/adapterSeam/clickup/signature.ts';
import { applyWebhookEvent } from '../../../pmo-portal/src/lib/adapterSeam/clickup/webhookApply.ts';
import type { ClickUpWebhookPayload } from '../../../pmo-portal/src/lib/adapterSeam/clickup/types.ts';
import type { ClickUpStatusMap } from '../../../pmo-portal/src/lib/adapterSeam/clickup/statusMap.ts';
import type { ClickUpMemberMap } from '../../../pmo-portal/src/lib/adapterSeam/clickup/memberMap.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { resolvePerOrgSecret } from '../_shared/perOrgSecret.ts';
import {
  CLICKUP_TIER,
  CLICKUP_TASKS_DOMAIN,
  mapsFromBindingConfig,
  createClickUpMirrorCallbacks,
} from '../_shared/clickupMirrorDeps.ts';

// 256 KiB body cap (review fix #7b): reject an oversized payload BEFORE req.text() so a huge body
// can't exhaust the isolate. ClickUp task webhooks are small JSON (<2 KB typical); 256 KiB is a
// generous ceiling that still bounds memory.
const MAX_WEBHOOK_BODY_BYTES = 262144;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface ResolvedBinding {
  orgId: string;
  projectId: string;
  statusMap: ClickUpStatusMap;
  memberMap: ClickUpMemberMap;
  webhookSecretRef?: string | null;
}

/** Resolve the per-project binding (org + project + maps) for an inbound task event. Returns `null`
 *  when no binding is resolvable (the event is ack'd and skipped — the sweep is the safety net). */
async function resolveBinding(
  serviceClient: SupabaseClient,
  payload: ClickUpWebhookPayload,
): Promise<ResolvedBinding | null> {
  // 1. Mapped path: external_refs(task_id) → org + pmo_record_id → the task row's project.
  const { data: ref } = await serviceClient
    .from('external_refs')
    .select('org_id, pmo_record_id')
    .eq('domain', CLICKUP_TASKS_DOMAIN)
    .eq('external_record_id', payload.task_id)
    .maybeSingle();
  const mappedRef = ref as { org_id: string; pmo_record_id: string } | null;
  if (mappedRef) {
    const { data: taskRow } = await serviceClient
      .from('tasks')
      .select('project_id')
      .eq('org_id', mappedRef.org_id)
      .eq('id', mappedRef.pmo_record_id)
      .maybeSingle();
    const projectId = (taskRow as { project_id: string } | null)?.project_id;
    if (projectId) {
      const binding = await loadBinding(serviceClient, mappedRef.org_id, projectId);
      if (binding) return binding;
    }
  }

  // 2. Adopt path: the payload's list_id → the binding directly (carries org + project + maps).
  if (payload.list_id) {
    const { data: byList } = await serviceClient
      .from('external_project_bindings')
      .select('org_id, project_id, config, webhook_secret_ref')
      .eq('external_tier', CLICKUP_TIER)
      .eq('external_container_id', payload.list_id)
      .maybeSingle();
    const row = byList as { org_id: string; project_id: string; config: unknown; webhook_secret_ref?: string | null } | null;
    if (row) return bindingFromRow(row);
  }

  // 3. P1 fallback: a single employing org with a single binding. If unambiguous, use it; else null.
  const { data: ownership } = await serviceClient
    .from('external_domain_ownership')
    .select('org_id')
    .eq('external_tier', CLICKUP_TIER)
    .eq('domain', CLICKUP_TASKS_DOMAIN);
  const orgIds = ((ownership as Array<{ org_id: string }> | null) ?? []).map((r) => r.org_id);
  if (orgIds.length === 1) {
    const { data: anyBinding } = await serviceClient
      .from('external_project_bindings')
      .select('org_id, project_id, config, webhook_secret_ref')
      .eq('org_id', orgIds[0])
      .eq('external_tier', CLICKUP_TIER)
      .maybeSingle();
    const row = anyBinding as { org_id: string; project_id: string; config: unknown; webhook_secret_ref?: string | null } | null;
    if (row) return bindingFromRow(row);
  }

  return null;
}

async function loadBinding(serviceClient: SupabaseClient, orgId: string, projectId: string): Promise<ResolvedBinding | null> {
  const { data } = await serviceClient
    .from('external_project_bindings')
    .select('org_id, project_id, config, webhook_secret_ref')
    .eq('org_id', orgId)
    .eq('project_id', projectId)
    .eq('external_tier', CLICKUP_TIER)
    .maybeSingle();
  const row = data as { org_id: string; project_id: string; config: unknown; webhook_secret_ref?: string | null } | null;
  return row ? bindingFromRow(row) : null;
}

function bindingFromRow(row: { org_id: string; project_id: string; config: unknown; webhook_secret_ref?: string | null }): ResolvedBinding {
  const { statusMap, memberMap } = mapsFromBindingConfig(row.config);
  return { orgId: row.org_id, projectId: row.project_id, statusMap, memberMap, webhookSecretRef: row.webhook_secret_ref ?? null };
}

/** Resolve the webhook secret for a binding: Vault-first when EXTERNAL_CONNECT_ENABLED=true, else global fallback. */
async function resolveWebhookSecret(
  serviceClient: SupabaseClient,
  binding: ResolvedBinding,
): Promise<string> {
  const globalSecret = Deno.env.get('CLICKUP_WEBHOOK_SECRET') ?? '';

  // Use shared per-org Vault secret resolution (flag gate + binding lookup + fallback)
  const vaultSecret = await resolvePerOrgSecret({
    connectEnabled: Deno.env.get('EXTERNAL_CONNECT_ENABLED') === 'true',
    orgId: binding.orgId,
    tier: 'clickup',
    column: 'webhook_secret_ref',
    lookupBinding: async (orgId, tier) => {
      const { data, error } = await serviceClient
        .from('external_project_bindings')
        .select('webhook_secret_ref')
        .eq('org_id', orgId)
        .eq('external_tier', tier)
        .maybeSingle();
      if (error) return null;
      return data as { webhook_secret_ref?: string | null } | null;
    },
    readVaultSecret: async (ref) => {
      const { data, error } = await serviceClient.rpc('read_vault_secret', { p_secret_ref: ref });
      if (error) {
        console.error('read_vault_secret failed', error);
        return null;
      }
      return (data as string | null) ?? null;
    },
  });

  return vaultSecret ?? globalSecret;
}

Deno.serve(async (req: Request): Promise<Response> => {
  // ── 0. Body-size cap (review fix #7b): reject Content-Length > 256 KiB BEFORE req.text() so a huge
  //    payload can't exhaust the isolate. Checked on the declared Content-Length (cheap header read). ──
  const declaredLength = Number(req.headers.get('Content-Length') ?? '0');
  if (declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);
  }

  // ── 1. Read the RAW body + the X-Signature header. ──
  const rawBody = await req.text();
  const signatureHeader = req.headers.get('X-Signature') ?? '';

  // ── 2. Parse the body to resolve binding + get appropriate secret. ──
  let payload: ClickUpWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as ClickUpWebhookPayload;
  } catch {
    return json({ error: 'BAD_REQUEST', message: 'invalid JSON body' }, 400);
  }
  if (!payload?.event || !payload?.task_id || !payload?.date_updated) {
    return json({ error: 'BAD_REQUEST', message: 'event, task_id, and date_updated are required' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'MISCONFIGURED', message: 'missing Supabase configuration' }, 500);
  }
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  // ── 3. Resolve the org + project + maps for this task. ──
  const binding = await resolveBinding(serviceClient, payload);
  if (!binding) {
    // No binding resolvable — ack and skip. The sweep (FR-CUA-045) is the safety net.
    return json({ ok: true, skipped: 'no-binding' });
  }

  // ── 4. Resolve webhook secret (Vault-first when flag is ON). ──
  const secret = await resolveWebhookSecret(serviceClient, binding);

  // ── 5. The HMAC is the sole trust boundary: verify signature with resolved secret. ──
  if (!secret || !(await verifyClickUpSignature(rawBody, signatureHeader, secret))) {
    return json({ error: 'UNAUTHORIZED' }, 401);
  }

  const { orgId, projectId, statusMap, memberMap } = binding;

  // ── 6. Apply via the pure engine. All DB access is scoped to orgId. ──
  const mirrorCallbacks = createClickUpMirrorCallbacks({ serviceClient, orgId, projectId });
  try {
    const outcome = await applyWebhookEvent(payload, {
      ...mirrorCallbacks,
      statusMap,
      memberMap,
      tombstoneMirror: async (pmoRecordId) => {
        const { error } = await serviceClient
          .from('tasks')
          .update({ tombstoned_at: new Date().toISOString() })
          .eq('org_id', orgId)
          .eq('id', pmoRecordId);
        if (error) throw new AppError(error.message, error.code);
      },
      surfaceDeletion: async (pmoRecordId, externalRecordId) => {
        console.warn(
          `[clickup-webhook] task tombstoned: org=${orgId} pmoRecordId=${pmoRecordId} clickupTaskId=${externalRecordId}`,
        );
      },
    });
    return json({ ok: true, outcome });
  } catch (err) {
    const appError = err instanceof AppError ? err : new AppError(err instanceof Error ? err.message : 'webhook apply failed');
    const code = appError.code;
    if (code === '23505') {
      return json({ error: 'CONCURRENT_ADOPT', message: 'a concurrent adopt is reconciling' }, 409);
    }
    console.error(`[clickup-webhook] apply failed: org=${orgId} code=${code ?? 'none'} detail=${appError.message}`);
    return json({ error: 'WEBHOOK_APPLY_FAILED', message: 'the webhook could not be applied' }, 500);
  }
});