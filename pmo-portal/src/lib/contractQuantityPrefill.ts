import { claimableHeadroom, milli, type ContractLineFacts } from '@/src/lib/progressBilling';

/**
 * Claim quantity suggestions per work order (ADR-0091 DD-CQ-6, AC-CQ-013). A pre-fill, never a rule: the person
 * edits it. Integer milli-units throughout — no binary-float quantity maths.
 *
 *   • a confirmed survey on this order: certified − claimed on this order (the claim ceiling, FR-SCW-3);
 *   • a confirmed BAST on this order:  accepted − claimed on this order (other orders' claims are irrelevant);
 *   • no BAST:                        min(assessed − claimed everywhere, ordered − claimed on this order).
 *
 * `acceptedQuantity === null` means no confirmed BAST; a BAST of zero is a BAST. Non-positive results are omitted.
 */

export interface WorkOrderPrefill {
  quantities: Record<string, number>;
  /** True when at least one suggestion comes from a confirmed BAST. */
  fromBast: boolean;
  /** True when at least one suggestion comes from a confirmed survey. */
  fromSurvey: boolean;
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
  let fromSurvey = false;
  for (const id of lineIds) {
    const allocation = contractLines.find((line) => line.boqItemId === id)?.allocations.find((a) => a.workOrderId === workOrderId);
    if (!allocation) continue;
    let suggested: number;
    if (allocation.surveyedQuantity != null) {
      suggested = Math.round(claimableHeadroom({ ordered: allocation.quantity, claimed: allocation.claimedQuantity, accepted: allocation.acceptedQuantity, surveyed: allocation.surveyedQuantity }).signedHeadroom * 1000);
      if (suggested > 0) fromSurvey = true;
    } else if (allocation.acceptedQuantity !== null) {
      suggested = Math.round(claimableHeadroom({ ordered: allocation.quantity, claimed: allocation.claimedQuantity, accepted: allocation.acceptedQuantity }).signedHeadroom * 1000);
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
  return { quantities, fromBast, fromSurvey };
}
