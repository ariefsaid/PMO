/**
 * #1599 ECX-3 — the ERP company's default accounts and cost centre, set from PMO (clients never work in the ERP).
 *
 * set-company-defaults: the CALLER asks the database (`request_company_defaults`, migration 0910), which re-asserts role,
 * membership and org and checks each choice against the mirrored chart; the tier's writer then checks the same rule against the
 * ERP's own records, writes only the fields that change and reads the company back; the database records only that read-back
 * (`record_company_defaults_result`). A refusal is recorded in plain words; an ERP that cannot be reached records nothing.
 *
 * company-defaults-options: refreshes the company's cost centres from the ERP into the mirror, then offers each slot only the
 * mirrored targets that fit it (the same rule), so a person is never shown a choice that would be refused, and says whether a
 * request for the connection is still being saved (`pending`), so Save waits for it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { AdapterError } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { COMPANY_DEFAULT_SLOTS, defaultTargetProblem, type CompanyDefaultSlot } from '../../../pmo-portal/src/lib/adapterSeam/companyDefaults.ts';
import { companyDefaultsForOrg, hasCompanyDefaultsWriter } from '../_shared/companyDefaultsForOrg.ts';
import { erpReason } from '../_shared/erpReason.ts';
import type { ConnectCtx } from './connect.ts';

/** How long a pending request counts as still being saved: past the longest a setup call can run, so a request whose save
 *  ended without an answer (the ERP could not be reached) does not hold Save back for good. */
export const PENDING_SAVE_WINDOW_MS = 5 * 60_000;

type RpcFailure = (e: { code?: string; message?: string }) => AppError;
interface Request { id: string; company: string; values: Record<string, string> }

function assertTier(tier: string): void {
  if (!hasCompanyDefaultsWriter(tier)) throw new AppError('Setting company defaults from PMO is not available for this ERP yet', 'BAD_REQUEST');
}

async function recordResult(sc: SupabaseClient, orgId: string, requestId: string, readBack: unknown, rejection: string | null) {
  const { data, error } = await sc.rpc('record_company_defaults_result', { p_org_id: orgId, p_request_id: requestId, p_read_back: readBack, p_rejection: rejection });
  if (error) throw new AppError('The change could not be recorded', 'INTERNAL');
  return data as { state: string; reason?: string };
}

export async function setCompanyDefaults(ctx: ConnectCtx, tier: string, rpcFailure: RpcFailure) {
  assertTier(tier);
  const { data, error } = await ctx.callerClient.rpc('request_company_defaults', { p_tier: tier, p_values: ctx.body.values ?? null });
  if (error) throw rpcFailure(error);
  const request = data as Request;
  const target = await companyDefaultsForOrg(ctx.serviceClient, ctx.orgId, tier);
  if (target.company !== request.company) {
    await recordResult(ctx.serviceClient, ctx.orgId, request.id, null, 'The ERP connection changed while this was being set, so nothing was recorded.');
    throw new AppError('The ERP connection changed; reload and try again', 'config-rejected');
  }
  let result;
  try {
    result = await target.writer.set(request.values);
  } catch (err) {
    if (err instanceof AdapterError && err.code === 'commit-rejected') {
      const reason = erpReason(err) ?? 'The ERP refused this change.';
      await recordResult(ctx.serviceClient, ctx.orgId, request.id, null, reason);
      throw new AppError(reason, 'config-rejected');
    }
    // The write may or may not have landed: record nothing; the request stays pending and a retry reads the company first.
    throw new AppError('The ERP could not be reached, so nothing was recorded. Try again.', 'external-unreachable');
  }
  const recorded = await recordResult(ctx.serviceClient, ctx.orgId, request.id, result.readBack, null);
  if (recorded.state !== 'applied') throw new AppError(recorded.reason ?? 'The change was not recorded. Try again.', 'config-rejected');
  return { ok: true, written: result.written, defaults: result.readBack };
}

export async function companyDefaultOptions(ctx: ConnectCtx, tier: string) {
  assertTier(tier);
  const target = await companyDefaultsForOrg(ctx.serviceClient, ctx.orgId, tier);
  let centres;
  try {
    centres = await target.costCentres();
  } catch {
    throw new AppError('The ERP could not be reached; try again.', 'external-unreachable');
  }
  const { error: mirrorError } = await ctx.serviceClient.rpc('replace_erp_cost_centre_mirror', { p_org_id: ctx.orgId, p_company: target.company, p_rows: centres });
  if (mirrorError) throw new AppError('The request could not be completed', 'INTERNAL');
  const [accounts, mirrored, pending] = await Promise.all([
    ctx.serviceClient.from('erp_account_mirror').select('erp_name,company,is_group,disabled,root_type,account_type')
      .eq('org_id', ctx.orgId).eq('company', target.company).eq('is_group', false).eq('disabled', false).order('erp_name').limit(5000),
    ctx.serviceClient.from('erp_cost_centre_mirror').select('erp_name,company,is_group,disabled')
      .eq('org_id', ctx.orgId).eq('company', target.company).eq('is_group', false).eq('disabled', false).order('erp_name').limit(5000),
    ctx.serviceClient.from('erp_company_default_requests').select('id')
      .eq('org_id', ctx.orgId).eq('external_tier', tier).eq('company', target.company).eq('state', 'pending')
      .gte('requested_at', new Date(Date.now() - PENDING_SAVE_WINDOW_MS).toISOString()).limit(1),
  ]);
  if (accounts.error || mirrored.error || pending.error) throw new AppError('The request could not be completed', 'INTERNAL');
  type Row = { erp_name: string; company: string; is_group: boolean; disabled: boolean; root_type?: string | null; account_type?: string | null };
  const fits = (slot: CompanyDefaultSlot, rows: Row[]) => rows.filter((row) => defaultTargetProblem(slot, target.company, {
    name: row.erp_name, company: row.company, isGroup: row.is_group, disabled: row.disabled, rootType: row.root_type ?? null, accountType: row.account_type ?? null,
  }) === null).map((row) => row.erp_name);
  const options = Object.fromEntries(COMPANY_DEFAULT_SLOTS.map((slot) =>
    [slot, fits(slot, (slot === 'cost_centre' ? mirrored.data : accounts.data) as Row[])]));
  return { company: target.company, options, pending: (pending.data ?? []).length > 0 };
}
