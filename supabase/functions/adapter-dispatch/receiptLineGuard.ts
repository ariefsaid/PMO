// #1783 item 1 (D17 / FR-PLN-004/006, AC-PLN-006): the tier-keyed receipt-line capability registry.
// A NEW caller-directed receipt line quantity (`receiptLines` on the Odoo tier, caller `items` on the
// ERPNext tier) on a body-building goods-receipt operation requires `procurement_full`; whole-purchase
// transport (no caller lines), inert cross-tier aliases and every other document kind stay Basic.
// Edge-only: the actual service-client RPC lives here so no caller can inject a verdict.
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';

/** The guard's refusal: HTTP 422 via the shared `dispatchErrorStatus` ladder. Exact wording per plan. */
export const RECEIPT_LINE_ENTITLEMENT_REFUSAL = 'Receipt line quantities require procurement full';

/** A caller-directed line array: non-empty only. An empty/non-array value directs no quantity and
 *  keeps its shipped validator refusal (`receipt-empty` / `receipt-lines-invalid`) — over-gating a
 *  Basic invalid input would change error precedence for a no-op shape. */
const hasNonEmptyArray = (value: unknown): boolean => Array.isArray(value) && value.length > 0;

const recordOf = (command: AdapterCommand): Record<string, unknown> =>
  (command.record ?? {}) as Record<string, unknown>;

/** The common precondition every tier's predicate shares: a procurement goods receipt. */
const isGoodsReceiptCommand = (command: AdapterCommand): boolean =>
  command.domain === 'procurement' && recordOf(command).erp_doc_kind === 'goods-receipt';

/**
 * Per-tier line predicates. The registry is the ONLY place a tier name decides line work — generic
 * code consults it, never a tier branch. `undefined` (unknown tier) yields false and preserves that
 * tier's existing dispatch behavior.
 *
 * - Odoo: only `create` is wired for goods receipts (every other operation is refused by the adapter
 *   before any outbox row), and only a non-empty `receiptLines` array directs quantities.
 * - ERPNext: the body-building operations are `create`, `update` (draft PUT and submitted amend both
 *   build a body) and `transition` with `verb === 'amend'`; `submit`/`cancel` act on the existing
 *   document and never build a body. Only non-empty caller `items` direct quantities — server-derived
 *   transport lines are stamped AFTER this guard and never select it.
 */
const RECEIPT_LINE_TIERS: Readonly<Record<string, (command: AdapterCommand, record: Record<string, unknown>) => boolean>> = {
  odoo: (_command, record) => hasNonEmptyArray(record.receiptLines),
  erpnext: (command, record) => {
    const operation = command.operation;
    const amend = operation === 'transition' && record.verb === 'amend';
    return (operation === 'create' || operation === 'update' || amend) && hasNonEmptyArray(record.items);
  },
};

/** Whether THIS command is a NEW caller-directed receipt line write on the named tier. The predicate
 *  must see the ORIGINAL inbound record — call it before any replay replaces `command.record`. */
export function requiresReceiptLineEntitlement(tier: string, command: AdapterCommand): boolean {
  const predicate = RECEIPT_LINE_TIERS[tier];
  if (!predicate || !isGoodsReceiptCommand(command)) return false;
  return predicate(command, recordOf(command));
}

/**
 * The served Full gate for a NEW caller-directed receipt line write (FR-PLN-004/006):
 *  - an already-accepted row for this exact identity (org + domain + PMO record + key) returns at
 *    once — accepted work resumes/closes through the EXISTING replay/M-3 protocol, never re-gated;
 *  - otherwise only a literal `true` from `service_feature_enabled(org,'procurement_full')` admits.
 *    `false`, `null`, any non-boolean body or an RPC error fail closed with a 422 refusal. An
 *    explicit off is never overridden; the resolver is the authority, never a payload flag or a map.
 *
 * No outbox row is minted and no ERP credential is read on a refusal: this runs before the adapter
 * factory and therefore before vault resolution, outbox insert and any ERP call.
 */
export async function assertNewReceiptLinesAllowed(args: {
  tier: string;
  command: AdapterCommand;
  orgId: string;
  serviceClient: SupabaseClient;
  existingRow: boolean;
}): Promise<void> {
  if (args.existingRow) return;
  if (!requiresReceiptLineEntitlement(args.tier, args.command)) return;
  const { data, error } = await args.serviceClient.rpc('service_feature_enabled', {
    p_org_id: args.orgId,
    p_key: 'procurement_full',
  });
  if (error || data !== true) throw new AppError(RECEIPT_LINE_ENTITLEMENT_REFUSAL, 'commit-rejected');
}
