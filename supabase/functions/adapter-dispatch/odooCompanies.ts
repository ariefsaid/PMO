/**
 * Companies under tier `odoo` (#1504 S8-B, FR-ODC-055): once an org employs `companies` in Odoo, a company created or edited in PMO
 * becomes a partner there. The adapter is `odoo/adapter.ts` (lookup-then-create on the `pmo:<id>` anchor); this file only supplies its
 * dispatch parts: a refusal before any outbox row, and the outbox deps. A create is keyed on the PMO record, never on the client's
 * per-click key, and a probe miss is HELD, never reissued: Odoo has no unique anchor on a partner, so a miss cannot prove the create
 * never landed (ADR-0058 C-1). An update only sets fields, so a lost answer is simply sent again.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Adapter } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import type { DispatchMoneyOutboxDeps } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { createOdooAdapter } from '../../../pmo-portal/src/lib/adapterSeam/odoo/adapter.ts';
import { bindCall, type OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { ODOO_TIER, odooSendProbe, toAdapterError } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts';
import { REQUEST_DEADLINE_MS } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/constants.ts';
import { odooConnectCtx } from '../_shared/odooConnectSends.ts';
import { countOdooCalls, withOdooCallBudget } from '../_shared/odooCallBudget.ts';
import { odooClientForOrg } from '../_shared/odooClientForOrg.ts';
import type { AdapterSelectContext } from './dispatchAdapters.ts';
import { createDbMoneyOutboxDeps } from './moneyOutboxDeps.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One PMO company is one Odoo partner, ever: the outbox key follows the record. A record id that is not a UUID refuses before any outbox row. */
export function odooCompanyAnchorKey(record: Record<string, unknown>): string {
  const id = String(record.id);
  if (!UUID.test(id)) throw new AppError('company-record-id-invalid', 'commit-rejected');
  return `odoo:companies:${id}`;
}

async function resolveClient(ctx: AdapterSelectContext) {
  const resolved = await odooClientForOrg(ctx.serviceClient as SupabaseClient, ctx.orgId);
  if ('refusal' in resolved) throw new AppError(`The Odoo connection is not usable (${resolved.refusal})`, 'config-rejected');
  return resolved;
}

export async function resolveOdooCompaniesAdapter(ctx: AdapterSelectContext): Promise<Adapter> {
  const resolved = await resolveClient(ctx);
  const call = countOdooCalls(bindCall({ ...resolved.client, deadlineMs: REQUEST_DEADLINE_MS }), ctx.odooCallBudget);
  return createOdooAdapter(call, odooConnectCtx(resolved));
}

export async function resolveOdooCompaniesMoneyOutboxDeps(ctx: AdapterSelectContext): Promise<DispatchMoneyOutboxDeps> {
  const operation = String(ctx.command.operation);
  if (operation !== 'create' && operation !== 'update') throw new AppError(`odoo companies do not support ${operation}`, 'commit-rejected');
  const resolved = await resolveClient(ctx);
  const raw = withOdooCallBudget(bindCall({ ...resolved.client, deadlineMs: REQUEST_DEADLINE_MS }), ctx.odooCallBudget);
  const call: OdooCall = async <T>(model: string, method: string, body?: Record<string, unknown>) => {
    try { return await raw<T>(model, method, body); } catch (err) { return toAdapterError(err); }
  };
  const odooCtx = odooConnectCtx(resolved);
  const r = ctx.command.record as Record<string, unknown>;
  return createDbMoneyOutboxDeps({
    serviceClient: ctx.serviceClient as never,
    orgId: ctx.orgId,
    externalTier: ODOO_TIER,
    operation,
    actorUserId: ctx.userId,
    reissueOnInconclusiveAbsence: operation === 'update',
    probeByRemarksKey: operation === 'create'
      ? () => odooSendProbe(call, odooCtx, 'party', { id: String(r.id), name: String(r.name ?? ''), role: r.type === 'Client' ? 'client' : 'vendor' })
      : async () => null,
  });
}
