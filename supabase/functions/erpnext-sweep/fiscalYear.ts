/**
 * Pass (3c) — keep the ERP one fiscal year ahead (#1599 ECX-5, fiscal-year.ensure). Once per binding per day, on the hourly
 * work: look the year up, create it only when absent, read it back (`erpnext/fiscalYear.ts`). The outcome the read-back shows
 * is stored on the binding's config (`fiscal_year`) through the atomic config merge, so the setup checklist can show an
 * Operator task in plain words. Every refusal (a 403 on the lookup or the create, any other ERP refusal, an answer PMO does not
 * decide on) is recorded, never skipped silently, and is not retried until the next daily pass; an unreachable ERP stores
 * nothing and is retried on the next hourly run. No fiscal-year error marks the hourly run failed (see `index.ts`). The
 * status names the company it was checked for, so a change of bound company is checked again the same day.
 *
 * The create is a direct, read-back write, not an outbox row: it is idempotent by lookup (the date range decides "covered"),
 * carries no money, and a lost answer is settled by the read-back on the same or the next run.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ErpClientDeps } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import { ensureNextFiscalYear } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/fiscalYear.ts';
import { erpReason } from '../_shared/erpReason.ts';
import type { OrgBinding } from './sweepShared.ts';

export const FISCAL_YEAR_CONFIG_KEY = 'fiscal_year';

/** What the binding config holds after a check (read by the setup readiness). `checked_on` is the UTC day of the check. */
export type FiscalYearStatus =
  | { state: 'ready'; checked_on: string; company: string; current: string; next: string }
  | { state: 'not-due'; checked_on: string; company: string; current: string }
  | { state: 'needs-operator'; checked_on: string; company: string; reason: 'missing-role' | 'no-current-year' }
  | { state: 'refused'; checked_on: string; company: string; message: string | null };

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
  // No company bound: the checklist's company step (a PMO step) already asks for it; nothing to check yet.
  if (!org.company) return { error: 'company-not-set' };
  const company = org.company;
  const prior = org.config?.[FISCAL_YEAR_CONFIG_KEY] as { checked_on?: unknown; company?: unknown } | undefined;
  if (prior?.checked_on === today && prior.company === company) return {};
  let status: FiscalYearStatus;
  try {
    const outcome = await ensureNextFiscalYear(await openClient(), company, today);
    const at = { checked_on: today, company };
    status = outcome.state === 'refused'
      ? { state: 'refused', ...at, message: outcome.message === null ? null : erpReason({ message: outcome.message }) }
      : outcome.state === 'ready'
      ? { state: 'ready', ...at, current: outcome.current, next: outcome.next }
      : outcome.state === 'not-due'
      ? { state: 'not-due', ...at, current: outcome.current }
      : { state: 'needs-operator', ...at, reason: outcome.reason };
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
