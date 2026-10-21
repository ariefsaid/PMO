import type { ContractLineFacts } from '@/src/lib/progressBilling';

/**
 * Claim quantity suggestions per work order (ADR-0091 DD-CQ-6, AC-CQ-013). A pre-fill, never a rule: the person
 * edits it. Integer milli-units throughout — no binary-float quantity maths.
 *
 *   • a confirmed BAST on this order:  accepted − claimed on this order (other orders' claims are irrelevant);
 *   • no BAST:                        min(assessed − claimed everywhere, ordered − claimed on this order).
 *
 * `acceptedQuantity === null` means no confirmed BAST; a BAST of zero is a BAST. Non-positive results are omitted.
 */
const milli = (value: number): number => Math.round(value * 1000);

export interface WorkOrderPrefill {
  quantities: Record<string, number>;
  /** True when at least one suggestion comes from a confirmed BAST. */
  fromBast: boolean;
}

export function prefillForWorkOrder(
  workOrderId: string,
  lineIds: readonly string[],
  contractLines: readonly ContractLineFacts[],
  assessed: Record<string, number>,
  claimedAll: Record<string, number>,
): WorkOrderPrefill {
  const quantities: Record<string, number> = {};
  let fromBast = false;
  for (const id of lineIds) {
    const allocation = contractLines.find((line) => line.boqItemId === id)?.allocations.find((a) => a.workOrderId === workOrderId);
    if (!allocation) continue;
    let suggested: number;
    if (allocation.acceptedQuantity !== null) {
      suggested = milli(allocation.acceptedQuantity) - milli(allocation.claimedQuantity);
      if (suggested > 0) fromBast = true;
    } else {
      if (assessed[id] === undefined) continue;
      suggested = Math.min(
        milli(assessed[id]) - milli(claimedAll[id] ?? 0),
        milli(allocation.quantity) - milli(allocation.claimedQuantity),
      );
    }
    if (suggested > 0) quantities[id] = suggested / 1000;
  }
  return { quantities, fromBast };
}
