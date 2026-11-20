/**
 * Pass (3c) — keep the ERP one fiscal year ahead (#1599 ECX-5, fiscal-year.ensure).
 * Uses immutable intent identity, fenced outbox reservation and single-POST guarantee.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { ErpError, type ErpClientDeps } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import { discoverFiscalYear } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/fiscalYear.ts';
import {
  ensureFiscalYearViaOutbox,
  type FiscalYearIntent,
} from '../../../pmo-portal/src/lib/adapterSeam/connect/fiscalYearOutbox.ts';
import { erpReason } from '../_shared/erpReason.ts';
import type { OrgBinding } from './sweepShared.ts';

export const FISCAL_YEAR_CONFIG_KEY = 'fiscal_year';

/** What the binding config holds after a check (read by setup readiness). */
export type FiscalYearStatus =
  | { state: 'ready'; checked_on: string; company: string; current: string; next: string }
  | { state: 'not-due'; checked_on: string; company: string; current: string }
  | { state: 'needs-operator'; checked_on: string; company: string; reason: 'missing-role' | 'no-current-year' }
  | { state: 'needs-operator'; checked_on: string; company: string; reason: 'disabled-year'; year: string }
  | { state: 'needs-operator'; checked_on: string; company: string; reason: 'held'; intentId: string }
  | { state: 'refused'; checked_on: string; company: string; message: string | null };

/** The UTC calendar day of `nowMs`. */
export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export async function ensureOrgFiscalYearLive(
  serviceClient: SupabaseClient,
  org: Pick<OrgBinding, 'orgId' | 'company' | 'config'> & {
    bindingId?: string | null;
    siteUrl?: string | null;
    activatedAt?: string | null;
  },
  openClient: () => Promise<ErpClientDeps>,
  today: string,
  mode: 'full' | 'recovery-only' = 'full',
): Promise<{ error?: string; checked?: boolean }> {
  if (!org.company) return { error: 'company-not-set' };
  const company = org.company;
  const bindingId = org.bindingId ?? '00000000-0000-0000-0000-000000000001';
  const siteUrl = org.siteUrl ?? 'https://erp.example.com';
  const activatedAt = org.activatedAt ?? '2026-01-01T00:00:00Z';

  // Step 1: Skip if same UTC day and unchanged binding/company (unless held intent needs driving)
  const prior = org.config?.[FISCAL_YEAR_CONFIG_KEY] as { checked_on?: unknown; company?: unknown; state?: string; reason?: string } | undefined;
  const isHeld = prior?.state === 'needs-operator' && prior?.reason === 'held';
  if (prior?.checked_on === today && prior.company === company && !isHeld) {
    return {};
  }

  // In recovery-only mode (money pass), only drive when a held intent needs operator recovery
  if (mode === 'recovery-only' && !isHeld) {
    return {};
  }

  // Step 2: Drive unsettled/held fiscal intent rows even when daily observation exists
  if (isHeld) {
    const { data: unsettledIntents } = await serviceClient
      .from('erp_fiscal_year_intents')
      .select('*')
      .eq('org_id', org.orgId)
      .eq('binding_id', bindingId)
      .order('created_at', { ascending: false });

    if (unsettledIntents && unsettledIntents.length > 0) {
      const latestIntent = unsettledIntents[0] as FiscalYearIntent;
      if (latestIntent.post_started_at) {
        const { data: outboxRows } = await serviceClient
          .from('external_command_outbox')
          .select('state')
          .eq('org_id', org.orgId)
          .eq('domain', 'fiscal_year_setup')
          .eq('pmo_record_id', latestIntent.id);

        const outboxState = outboxRows?.[0]?.state;
        if (outboxState === 'held') {
          const status: FiscalYearStatus = {
            state: 'needs-operator',
            checked_on: today,
            company,
            reason: 'held',
            intentId: latestIntent.id,
          };
          await serviceClient.rpc('record_fiscal_year_observation', {
            p_org_id: org.orgId,
            p_binding_id: bindingId,
            p_company: company,
            p_site_url: siteUrl,
            p_activated_at: activatedAt,
            p_checked_at: new Date().toISOString(),
            p_status: status,
          });
          org.config = { ...(org.config ?? {}), [FISCAL_YEAR_CONFIG_KEY]: status };
          return { checked: true };
        }
      }
    }
  }

  if (mode === 'recovery-only') {
    return {};
  }

  // Step 3: Run read-only discovery
  let client: ErpClientDeps;
  try {
    client = await openClient();
  } catch (err) {
    return { error: erpReason(err) ?? 'erp-unreachable' };
  }

  let discovery;
  try {
    discovery = await discoverFiscalYear(client, company, today);
    console.log('[ensureOrgFiscalYearLive] org:', org.orgId, 'company:', company, 'today:', today, 'discovery:', JSON.stringify(discovery));
  } catch (err) {
    console.error('[ensureOrgFiscalYearLive] discoverFiscalYear error:', err);
    return { error: erpReason(err) ?? 'erp-unreachable' };
  }

  if (discovery.state === 'not-due') {
    const status: FiscalYearStatus = {
      state: 'not-due',
      checked_on: today,
      company,
      current: discovery.current,
    };
    const { error } = await serviceClient.rpc('record_fiscal_year_observation', {
      p_org_id: org.orgId,
      p_binding_id: bindingId,
      p_company: company,
      p_site_url: siteUrl,
      p_activated_at: activatedAt,
      p_checked_at: new Date().toISOString(),
      p_status: status,
    });
    if (error) return { error: `status-write-failed:${error.code ?? 'unknown'}` };
    org.config = { ...(org.config ?? {}), [FISCAL_YEAR_CONFIG_KEY]: status };
    return { checked: true };
  }

  if (discovery.state === 'ready') {
    const status: FiscalYearStatus = {
      state: 'ready',
      checked_on: today,
      company,
      current: discovery.current,
      next: discovery.next,
    };
    const { error } = await serviceClient.rpc('record_fiscal_year_observation', {
      p_org_id: org.orgId,
      p_binding_id: bindingId,
      p_company: company,
      p_site_url: siteUrl,
      p_activated_at: activatedAt,
      p_checked_at: new Date().toISOString(),
      p_status: status,
    });
    if (error) return { error: `status-write-failed:${error.code ?? 'unknown'}` };
    org.config = { ...(org.config ?? {}), [FISCAL_YEAR_CONFIG_KEY]: status };
    return { checked: true };
  }

  if (discovery.state === 'operator') {
    const status: FiscalYearStatus = discovery.message
      ? {
          state: 'refused',
          checked_on: today,
          company,
          message: discovery.message.replace(/<[^>]*>/g, ''),
        }
      : ({
          state: 'needs-operator',
          checked_on: today,
          company,
          reason: discovery.reason,
          ...(discovery.year ? { year: discovery.year } : {}),
        } as FiscalYearStatus);
    const { error } = await serviceClient.rpc('record_fiscal_year_observation', {
      p_org_id: org.orgId,
      p_binding_id: bindingId,
      p_company: company,
      p_site_url: siteUrl,
      p_activated_at: activatedAt,
      p_checked_at: new Date().toISOString(),
      p_status: status,
    });
    if (error) return { error: `status-write-failed:${error.code ?? 'unknown'}` };
    org.config = { ...(org.config ?? {}), [FISCAL_YEAR_CONFIG_KEY]: status };
    return { checked: true };
  }

  // discovery.state === 'create'
  const { data: intentData, error: prepError } = await serviceClient.rpc('prepare_fiscal_year_intent', {
    p_org_id: org.orgId,
    p_binding_id: bindingId,
    p_company: company,
    p_site_url: siteUrl,
    p_activated_at: activatedAt,
    p_start: discovery.start,
    p_end: discovery.end,
    p_year_name: discovery.yearName,
  });

  const intentRow = intentData as { id?: string } | string | null;
  const intentId = typeof intentRow === 'object' && intentRow !== null ? intentRow.id : intentRow;

  if (prepError || !intentId) {
    console.error('[ensureOrgFiscalYearLive] prepare_fiscal_year_intent failed:', prepError);
    return { error: `intent-prepare-failed:${prepError?.message ?? 'unknown'}` };
  }
  console.log('[ensureOrgFiscalYearLive] prepared intent:', intentId);

  const intent: FiscalYearIntent = {
    id: intentId,
    org_id: org.orgId,
    binding_id: bindingId,
    company,
    site_url: siteUrl,
    activated_at: activatedAt,
    target_start: discovery.start,
    target_end: discovery.end,
    year_name: discovery.yearName,
    current_year: discovery.current,
    checked_on: today,
  };

  try {
    const res = await ensureFiscalYearViaOutbox({ serviceClient, erpClient: client }, intent);
    console.log('[ensureOrgFiscalYearLive] ensureFiscalYearViaOutbox succeeded:', JSON.stringify(res));
    const recordedStatus = (res.canonical as { status?: FiscalYearStatus } | undefined)?.status;
    const status: FiscalYearStatus = recordedStatus ?? {
      state: 'ready',
      checked_on: today,
      company,
      current: discovery.current,
      next: res.externalRecordId,
    };
    org.config = { ...(org.config ?? {}), [FISCAL_YEAR_CONFIG_KEY]: status };
    return { checked: true };
  } catch (err) {
    console.error('[ensureOrgFiscalYearLive] ensureFiscalYearViaOutbox threw:', err);
    const reason = erpReason(err) ?? (err instanceof Error ? err.message : String(err));
    const errMsg = String((err as { message?: string })?.message ?? '');
    const isUnreachable =
      reason === 'external system unreachable — try again' ||
      (err instanceof ErpError && err.code === 'external-unreachable') ||
      reason.includes('network down') ||
      errMsg.includes('network down') ||
      errMsg.includes('external-unreachable');
    if (isUnreachable) {
      return { error: reason };
    }
    const status: FiscalYearStatus = {
      state: 'needs-operator',
      checked_on: today,
      company,
      reason: 'held',
      intentId: intent.id,
    };
    await serviceClient.rpc('record_fiscal_year_observation', {
      p_org_id: org.orgId,
      p_binding_id: bindingId,
      p_company: company,
      p_site_url: siteUrl,
      p_activated_at: activatedAt,
      p_checked_at: new Date().toISOString(),
      p_status: status,
    });
    org.config = { ...(org.config ?? {}), [FISCAL_YEAR_CONFIG_KEY]: status };
    return { error: reason ?? 'fiscal-year-held', checked: true };
  }
}
