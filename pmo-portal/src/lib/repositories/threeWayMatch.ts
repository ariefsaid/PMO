/**
 * repositories/threeWayMatch.ts (#2622, #2634) — the seam over the three-way match (1018, 1357, ADR-0019): read a bill's
 * match, approve a held bill's exception, read and set the organisation's setting, record receipt and bill lines.
 * Standalone module (same shape as `workOrderCosts.ts`): imported directly by its consumers. Errors keep their code via `wrap`.
 */
import {
  approveBillMatchException, getBillMatch, getRecordedMatchLines, getThreeWayMatchHeldCount, getThreeWayMatchSettings,
  listOrderedItems, recordBillMatchLines, recordReceiptMatchLines, setThreeWayMatchSettings,
} from '@/src/lib/db/threeWayMatch';
import type { BillMatch, BillMatchLine, BillMatchLineReason, BillMatchReason, BillMatchStatus, MatchLineInput, OrderedItem, ThreeWayMatchSettings } from '@/src/lib/db/threeWayMatch';
import { wrap } from './repositoryErrors';

export type { BillMatch, BillMatchLine, BillMatchLineReason, BillMatchReason, BillMatchStatus, MatchLineInput, OrderedItem, ThreeWayMatchSettings };

export const threeWayMatchRepository = {
  billMatch: (invoiceId: string): Promise<BillMatch> => wrap(() => getBillMatch(invoiceId)),
  approveException: (invoiceId: string, reason: string): Promise<BillMatch> => wrap(() => approveBillMatchException(invoiceId, reason)),
  settings: (): Promise<ThreeWayMatchSettings | null> => wrap(() => getThreeWayMatchSettings()),
  saveSettings: (input: { enabled: boolean; quantityTolerancePct: number; amountTolerancePct: number }): Promise<ThreeWayMatchSettings> => wrap(() => setThreeWayMatchSettings(input)),
  heldCount: (): Promise<number> => wrap(() => getThreeWayMatchHeldCount()),
  orderedItems: (procurementId: string): Promise<OrderedItem[]> => wrap(() => listOrderedItems(procurementId)),
  recordedLines: (kind: 'receipt' | 'bill', id: string): Promise<MatchLineInput[]> => wrap(() => getRecordedMatchLines(kind, id)),
  recordReceiptLines: (receiptId: string, lines: Array<{ itemId: string; quantity: number }>): Promise<void> => wrap(() => recordReceiptMatchLines(receiptId, lines)),
  recordBillLines: (invoiceId: string, lines: Array<{ itemId: string; quantity: number; rate: number }>): Promise<BillMatch> => wrap(() => recordBillMatchLines(invoiceId, lines)),
};
