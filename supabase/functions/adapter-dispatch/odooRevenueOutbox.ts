import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { DispatchMoneyOutboxDeps } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { ODOO_TIER } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts';
import { REVENUE_KEY_RE, type RevenueKind } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/anchors.ts';
import { odooClientForOrg } from '../_shared/odooClientForOrg.ts';
import { canonicalCommandDigest, createDbMoneyOutboxDeps } from './moneyOutboxDeps.ts';
import type { AdapterSelectContext } from './dispatchAdapters.ts';

/** The PMO document kinds a revenue command names (the shared command shape) and the key prefix each anchors under (PD-4). */
const KEY_PREFIX: Readonly<Record<RevenueKind, string>> = { 'sales-invoice': 'si', 'incoming-payment': 'ip' };
const isRevenueKind = (kind: unknown): kind is RevenueKind => typeof kind === 'string' && kind in KEY_PREFIX;

/**
 * PD-4: the anchor key follows the PMO record, never the client's per-click idempotency key, and is the same whether the invoice is
 * ordinary, a claim, a down payment or a T&M claim (one invoice record -> one Odoo invoice, ever). A record id that is not a UUID cannot
 * reach Odoo: it refuses before any outbox row.
 */
export function odooRevenueAnchorKey(kind: RevenueKind, record: Record<string, unknown>): string {
  const key = `${KEY_PREFIX[kind]}:${String(record.id)}`;
  if (!REVENUE_KEY_RE.test(key)) throw new AppError('revenue-record-id-invalid', 'commit-rejected');
  return key;
}

/**
 * The DB-backed money-outbox deps for ONE Odoo revenue command (FR-OCI-001, DD-OCI-1): the shared outbox, claim, fence and finalize.
 * Both revenue anchors are composite hold-on-doubt (SD-6/SD-7), so a recovery that finds nothing is HELD, never reissued. The recovery probe
 * itself arrives with the adapter steps (C3-C5); until then a probe holds the row (an unconfirmed outcome is never reported as success).
 */
export async function resolveOdooRevenueMoneyOutboxDeps(ctx: AdapterSelectContext): Promise<DispatchMoneyOutboxDeps> {
  const operation = ctx.command.operation as string;
  if (operation === 'delete') throw new AppError('odoo adapter does not support delete', 'commit-rejected');
  const record = ctx.command.record as Record<string, unknown>;
  const docKind = record.erp_doc_kind;
  if (!isRevenueKind(docKind)) throw new AppError(`odoo revenue kind '${String(docKind)}' is not wired`, 'commit-rejected');
  odooRevenueAnchorKey(docKind, record);
  const resolved = await odooClientForOrg(ctx.serviceClient as SupabaseClient, ctx.orgId);
  if ('refusal' in resolved) throw new AppError(`The Odoo connection is not usable (${resolved.refusal})`, 'config-rejected');
  const payload: Record<string, unknown> = { ...record, erp_doc_kind: docKind };
  return createDbMoneyOutboxDeps({
    serviceClient: ctx.serviceClient as never,
    orgId: ctx.orgId,
    externalTier: ODOO_TIER,
    operation: operation as 'create' | 'update' | 'transition',
    actorUserId: ctx.userId,
    reissueOnInconclusiveAbsence: false,
    payload,
    payloadDigest: await canonicalCommandDigest({ domain: ctx.command.domain, operation, record: payload }),
    probeByRemarksKey: async () => { throw new AppError('odoo-revenue-recovery-unavailable', 'commit-rejected'); },
  });
}
