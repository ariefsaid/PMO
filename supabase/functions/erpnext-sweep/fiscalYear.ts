/**
 * Pass (3c) — keep the ERP one fiscal year ahead (#1599 ECX-5, fiscal-year.ensure). Once per binding per day, on the hourly
 * work: look the year up, create it only when absent, read it back (`erpnext/fiscalYear.ts`). The outcome the read-back shows
 * is stored on the binding's config (`fiscal_year`) through the atomic config merge, so the setup checklist can show an
 * Operator task in plain words. A permission refusal is recorded, never skipped silently; an unreachable ERP stores nothing
 * and is retried on a later tick.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ErpClientDeps } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import { ensureNextFiscalYear } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/fiscalYear.ts';
import { erpReason } from '../_shared/erpReason.ts';
import type { OrgBinding } from './sweepShared.ts';

export const FISCAL_YEAR_CONFIG_KEY = 'fiscal_year';

/** What the binding config holds after a check (read by the setup readiness). `checked_on` is the UTC day of the check. */
export type FiscalYearStatus =
  | { state: 'ready'; checked_on: string; current: string; next: string }
  | { state: 'not-due'; checked_on: string; current: string }
  | { state: 'needs-operator'; checked_on: string; reason: 'missing-role' | 'no-current-year' }
  | { state: 'refused'; checked_on: string; message: string | null };

/** The UTC calendar day of `nowMs`. */
export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export async function ensureOrgFiscalYearLive(
  serviceClient: SupabaseClient,
  org: Pick<OrgBinding, 'orgId' | 'company' | 'config'>,
  openClient: () => Promise<ErpClientDeps>,
  today: string,
): Promise<{ error?: string; checked?: boolean }> {
  const prior = org.config?.[FISCAL_YEAR_CONFIG_KEY] as { checked_on?: unknown } | undefined;
  if (prior?.checked_on === today) return {};
  if (!org.company) return { error: 'company-not-set' };
  let status: FiscalYearStatus;
  try {
    const outcome = await ensureNextFiscalYear(await openClient(), org.company, today);
    status = outcome.state === 'refused'
      ? { state: 'refused', checked_on: today, message: outcome.message === null ? null : erpReason({ message: outcome.message }) }
      : outcome.state === 'ready'
      ? { state: 'ready', checked_on: today, current: outcome.current, next: outcome.next }
      : outcome.state === 'not-due'
      ? { state: 'not-due', checked_on: today, current: outcome.current }
      : { state: 'needs-operator', checked_on: today, reason: outcome.reason };
  } catch (err) {
    return { error: erpReason(err) ?? 'erp-unreachable' };
  }
  const { error } = await serviceClient.rpc('merge_external_org_binding_config', {
    p_org_id: org.orgId, p_external_tier: 'erpnext', p_patch: { [FISCAL_YEAR_CONFIG_KEY]: status },
  });
  if (error) return { error: `status-write-failed:${error.code ?? 'unknown'}` };
  // The in-memory binding follows what was stored, so a later pass of this tick sees the check.
  org.config = { ...(org.config ?? {}), [FISCAL_YEAR_CONFIG_KEY]: status };
  return { checked: true };
}
