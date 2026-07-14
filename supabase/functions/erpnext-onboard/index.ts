/**
 * erpnext-onboard — Deno Edge Function entry point (task 3.9, AC-ENA-041). Thin wiring ONLY — the
 * pull-adopt orchestration lives in the pure, Deno-importable `erpnext/onboarding.ts`
 * (`onboardParties`/`listErpPartySources`), unit/idempotency-tested under `index.test.ts` (this dir)
 * + `erpnext/onboarding.test.ts`. This file is INTEGRATION-ONLY (not unit-tested) — verified by
 * `deno check` (the same contract as `clickup-onboard/index.ts`, `adapter-dispatch/index.ts`).
 *
 * Operator/service-role-guarded: `verify_jwt = false` and the handler verifies the bearer itself (it
 * MUST equal SUPABASE_SERVICE_ROLE_KEY, constant-time) — onboarding is an operator action, not a
 * browser-JWT path (mirrors `clickup-onboard/index.ts`).
 *
 * Credentials (H-3 audit fix — per-org, NOT a global pair): the org's ERPNext API key/secret are
 * resolved from THIS org's `external_org_bindings.secret_ref` (NFR-ENA-SEC-002, OQ-6) via
 * `resolveErpCredentials`, exactly as `adapter-dispatch/index.ts` — failing CLOSED (`config-rejected`)
 * when either is unset. The prior global `ERPNEXT_API_KEY`/`ERPNEXT_API_SECRET` placeholder is REMOVED
 * (it could have onboarded org A against another ERP tenant's credentials if ever used multi-org).
 */

// Deno-native imports (not in pmo-portal/package.json)
import { createClient } from '@supabase/supabase-js';
import { constantTimeBearerEquals } from '../_shared/constantTimeBearerEquals.ts';
import { onboardParties, listErpPartySources } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/onboarding.ts';
import { ERPNEXT_TIER } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';
import { resolveErpCredentials } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/credentials.ts';
import { resolveErpCredentialsFromVault } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/vaultCredentials.ts';
import { findPmoRecordId, recordExternalRef as recordExternalRefWrite } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { ErpClientDeps } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import type { PartyCandidate, PartyDoctype } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/partyAdopt.ts';
import type { PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request): Promise<Response> => {
  // ── 1. Authorization: the caller (an Operator action) must present the service-role bearer. ──
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!serviceRoleKey || !(await constantTimeBearerEquals(authHeader, `Bearer ${serviceRoleKey}`))) {
    return json({ error: 'UNAUTHORIZED' }, 401);
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  if (!supabaseUrl) return json({ error: 'MISCONFIGURED', message: 'missing SUPABASE_URL' }, 500);

  let body: { orgId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'BAD_REQUEST', message: 'invalid JSON body' }, 400);
  }
  const orgId = body.orgId;
  if (!orgId) return json({ error: 'BAD_REQUEST', message: 'orgId is required' }, 400);

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { data: bindingRow, error: bindingError } = await serviceClient
      .from('external_org_bindings')
      .select('site_url, secret_ref, activated_at')
      .eq('org_id', orgId)
      .eq('external_tier', ERPNEXT_TIER)
      .maybeSingle();
    if (bindingError || !bindingRow) {
      throw new AppError('no erpnext binding configured for this org', bindingError?.code ?? 'BINDING_NOT_FOUND');
    }
    const binding = bindingRow as { site_url: string; secret_ref: string; activated_at: string | null };
    if (!binding.activated_at) {
      throw new AppError('erpnext binding is not activated (version handshake mismatch or never activated)', 'config-rejected');
    }

    // H-3: per-org credentials from THIS org's secret_ref (fails closed if unset) — never a global pair.
    // Phase 1b (task 1.8): Vault-first resolution behind EXTERNAL_CONNECT_ENABLED flag.
    // When flag is ON: try Vault via resolveErpCredentialsFromVault; on failure fall back to env resolver.
    // When flag is OFF (default): use existing env resolver (legacy behavior unchanged).
    let apiKey: string;
    let apiSecret: string;
    const connectEnabled = Deno.env.get('EXTERNAL_CONNECT_ENABLED') === 'true';

    if (connectEnabled) {
      // Build readVaultSecret using service-role RPC
      const readVaultSecret = async (ref: string): Promise<string | null> => {
        const { data, error } = await serviceClient.rpc('read_vault_secret', { p_secret_ref: ref });
        if (error) {
          console.error('read_vault_secret failed', error);
          return null;
        }
        return (data as string | null) ?? null;
      };

      try {
        const creds = await resolveErpCredentialsFromVault(binding.secret_ref, readVaultSecret);
        apiKey = creds.apiKey;
        apiSecret = creds.apiSecret;
      } catch (e) {
        // Vault resolution failed (config-rejected or null) — fall back to env resolver
        console.warn('ERPNext Vault credential resolution failed, falling back to env resolver:', e instanceof Error ? e.message : String(e));
        const creds = resolveErpCredentials(binding.secret_ref, (key) => Deno.env.get(key));
        apiKey = creds.apiKey;
        apiSecret = creds.apiSecret;
      }
    } else {
      // Legacy path: env resolver only (byte-for-byte pre-change behavior)
      const creds = resolveErpCredentials(binding.secret_ref, (key) => Deno.env.get(key));
      apiKey = creds.apiKey;
      apiSecret = creds.apiSecret;
    }

    const clientDeps: ErpClientDeps = { fetchImpl: fetch, apiKey, apiSecret, baseUrl: binding.site_url };

    const sources = await listErpPartySources(clientDeps);

    const result = await onboardParties(sources, {
      findPmoRecordId: (externalRecordId) => findPmoRecordId(serviceClient as never, orgId, 'companies', externalRecordId),
      findCandidates: async (doctype: PartyDoctype, name: string): Promise<PartyCandidate[]> => {
        const targetType = doctype === 'Supplier' ? 'Vendor' : 'Client';
        const { data, error } = await serviceClient
          .from('companies')
          .select('id, erp_tax_id')
          .eq('org_id', orgId)
          .eq('type', targetType)
          .eq('name', name);
        if (error) throw new AppError(error.message, error.code);
        return ((data ?? []) as Array<{ id: string; erp_tax_id: string | null }>).map((row) => ({ pmoRecordId: row.id, taxId: row.erp_tax_id }));
      },
      insertCompaniesMirror: async (canonical: PmoRecord) => {
        const { error } = await serviceClient.from('companies').insert({
          id: canonical.id,
          org_id: orgId,
          name: canonical.name,
          type: canonical.type,
          erp_party_type: canonical.erp_party_type ?? null,
          erp_supplier_name: canonical.erp_supplier_name ?? null,
          erp_customer_name: canonical.erp_customer_name ?? null,
          erp_tax_id: canonical.erp_tax_id ?? null,
          erp_payment_terms_days: canonical.erp_payment_terms_days ?? null,
        });
        if (error) throw new AppError(error.message, error.code);
      },
      updateCompaniesMirror: async (pmoRecordId: string, canonical: PmoRecord) => {
        const { error } = await serviceClient
          .from('companies')
          .update({
            name: canonical.name,
            type: canonical.type,
            erp_party_type: canonical.erp_party_type ?? null,
            erp_supplier_name: canonical.erp_supplier_name ?? null,
            erp_customer_name: canonical.erp_customer_name ?? null,
            erp_tax_id: canonical.erp_tax_id ?? null,
            erp_payment_terms_days: canonical.erp_payment_terms_days ?? null,
          })
          .eq('org_id', orgId)
          .eq('id', pmoRecordId);
        if (error) throw new AppError(error.message, error.code);
      },
      recordExternalRef: (mapping) => recordExternalRefWrite(serviceClient as never, { ...mapping, orgId, domain: 'companies', externalTier: ERPNEXT_TIER }),
    });

    return json({ ok: true, ...result });
  } catch (err) {
    const appError = err instanceof AppError ? err : new AppError(err instanceof Error ? err.message : 'onboarding failed');
    const status = appError.code === 'action-required' ? 409 : appError.code === 'config-rejected' ? 422 : appError.code === 'external-unreachable' ? 502 : 500;
    return json({ error: appError.code ?? 'ONBOARDING_FAILED', message: appError.message }, status);
  }
});
