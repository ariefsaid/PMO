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
 * Credentials (H-3 audit fix — per-org, NOT a global pair; #654): resolved by the shared
 * `_shared/erpAuthPair.ts` (kill switch → Vault → env pair named by THIS org's `secret_ref`), failing
 * CLOSED (`config-rejected`) when disabled, unreadable or unset. The prior global `ERPNEXT_API_KEY`/`ERPNEXT_API_SECRET` placeholder is REMOVED
 * (it could have onboarded org A against another ERP tenant's credentials if ever used multi-org).
 */

// Deno-native imports (not in pmo-portal/package.json)
import { createClient } from '@supabase/supabase-js';
import { constantTimeBearerEquals } from '../_shared/constantTimeBearerEquals.ts';
import { onboardParties, listErpPartySources, listErpContactSources } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/onboarding.ts';
import { ensureErpCustomFields } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/erpCustomFields.ts';
import { ensureErpSellingSettings } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/erpSellingSettings.ts';
import { ERPNEXT_TIER } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';
import { resolveErpAuthPair } from '../_shared/erpAuthPair.ts';
import { findPmoRecordId, recordExternalRef as recordExternalRefWrite } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { applyErpContact } from '../_shared/erpnextContacts.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { ErpClientDeps } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import type { PartyCandidate, PartyDoctype } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/partyAdopt.ts';
import type { PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { serveWithErrorReporting } from '../_shared/serveWithErrorReporting.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } }); // #641
}

export async function handleOnboardRequest(req: Request): Promise<Response> {
  // ── 1. Authorization: the caller (an Operator action) must present the service-role bearer. ──
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!serviceRoleKey || !(await constantTimeBearerEquals(authHeader, `Bearer ${serviceRoleKey}`))) {
    return json({ error: 'UNAUTHORIZED' }, 401);
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });
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

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

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

    // H-3 + #654: per-org credentials via THE shared resolver (kill switch → Vault → env pair → refuse,
    // fail-closed on a store error) — the same path as the sweep and the outbound writers (FR-ENA-015).
    const { apiKey, apiSecret } = await resolveErpAuthPair(serviceClient, { orgId, secretRef: binding.secret_ref });

    const clientDeps: ErpClientDeps = { fetchImpl: fetch, apiKey, apiSecret, baseUrl: binding.site_url };

    // #767: the site custom fields PMO's bodies write (ERPNext silently drops unknown keys). Reported
    // per field, never fatal — a missing field costs only its own value, not party onboarding.
    const customFields = await ensureErpCustomFields(clientDeps);
    // #766 (DD-PBL-12a): progress billing's recovery line is a negative rate — enable it site-wide (reported, never fatal).
    const sellingSettings = await ensureErpSellingSettings(clientDeps);

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

    const contacts = {adopted: 0, reconciled: 0};
    for (const source of await listErpContactSources(clientDeps)) {
      try {
        const outcome = await applyErpContact(serviceClient, orgId, source.record.id, source.record, source.sourceModMs);
        if (outcome.kind === 'upserted') {
          if (outcome.adopted) contacts.adopted++; else contacts.reconciled++;
        }
      } catch (err) {
        // Unlinked contacts are outside this org's adopted party directory.
        if ((err as {code?: string}).code !== 'contact-parent-unmapped') throw err;
      }
    }
    return json({ ok: true, ...result, contacts, customFields, sellingSettings });
  } catch (err) {
    const appError = err instanceof AppError ? err : new AppError(err instanceof Error ? err.message : 'onboarding failed');
    const status = appError.code === 'action-required' ? 409 : appError.code === 'config-rejected' ? 422 : appError.code === 'external-unreachable' ? 502 : 500;
    return json({ error: appError.code ?? 'ONBOARDING_FAILED', message: appError.message }, status);
  }
}

if (import.meta.main) {
  serveWithErrorReporting('erpnext-onboard', handleOnboardRequest);
}
