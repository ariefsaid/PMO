/**
 * #766 / ADR-0077 — the Sales Invoice lines of a billing claim, built ONLY from the immutable claim rows.
 * A down payment is one line on the org's down-payment item; a progress claim is one line per claimed BoQ line
 * plus, when it recovers part of the down payment, one NEGATIVE-rate line on that same item. The item's ERPNext
 * income account is the customer-advance account, so that line debits the advance instead of revenue.
 * No account is ever sent — the body contract of `bodies/salesInvoice.ts` stands.
 */
import { AdapterError } from '../contract.ts';
import type { PmoLineItem } from './bodies/shared.ts';

export interface ProgressClaimRecord {
  id: string;
  kind: 'down_payment' | 'progress';
  project_id: string;
  work_order_id: string | null;
  currency?: string;
  down_payment_amount: number | string | null;
  dp_recovery_amount: number | string;
  dp_item_code: string | null;
  withdrawn_at: string | null;
}

export interface ProgressClaimLineRecord {
  item_code: string;
  description: string;
  unit: string;
  quantity: number | string;
  rate: number | string;
}

export function progressClaimItems(
  claim: ProgressClaimRecord,
  lines: readonly ProgressClaimLineRecord[],
): PmoLineItem[] {
  if (claim.withdrawn_at) {
    throw new AdapterError('commit-rejected', 'This progress claim was withdrawn, so no invoice can be raised for it');
  }
  if (claim.kind === 'down_payment') {
    if (!claim.dp_item_code || claim.down_payment_amount === null) {
      throw new AdapterError('commit-rejected', 'This down payment claim is incomplete');
    }
    return [{ item_code: claim.dp_item_code, qty: 1, rate: Number(claim.down_payment_amount) }];
  }
  if (lines.length === 0) throw new AdapterError('commit-rejected', 'This progress claim has no quantity lines');
  const items: PmoLineItem[] = lines.map((line) => ({
    item_code: line.item_code,
    qty: Number(line.quantity),
    rate: Number(line.rate),
    description: `${line.description} (${line.unit})`,
  }));
  const recovery = Number(claim.dp_recovery_amount);
  if (recovery > 0) {
    if (!claim.dp_item_code) {
      throw new AdapterError('commit-rejected', 'This progress claim recovers a down payment but names no down payment item');
    }
    items.push({ item_code: claim.dp_item_code, qty: 1, rate: -recovery });
  }
  return items;
}
