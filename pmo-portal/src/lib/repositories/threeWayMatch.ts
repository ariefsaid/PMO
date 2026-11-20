/**
 * repositories/threeWayMatch.ts (#2622) — the seam over the three-way match (1018, ADR-0019): read a bill's match, approve
 * a held bill's exception, read the organisation's setting. Standalone module (same shape as `workOrderCosts.ts`):
 * imported directly by its consumers. Errors keep their code via `wrap`.
 */
import { approveBillMatchException, getBillMatch, getThreeWayMatchSettings } from '@/src/lib/db/threeWayMatch';
import type { BillMatch, BillMatchLine, BillMatchLineReason, BillMatchReason, BillMatchStatus, ThreeWayMatchSettings } from '@/src/lib/db/threeWayMatch';
import { wrap } from './repositoryErrors';

export type { BillMatch, BillMatchLine, BillMatchLineReason, BillMatchReason, BillMatchStatus, ThreeWayMatchSettings };

export const threeWayMatchRepository = {
  billMatch: (invoiceId: string): Promise<BillMatch> => wrap(() => getBillMatch(invoiceId)),
  approveException: (invoiceId: string, reason: string): Promise<BillMatch> => wrap(() => approveBillMatchException(invoiceId, reason)),
  settings: (): Promise<ThreeWayMatchSettings | null> => wrap(() => getThreeWayMatchSettings()),
};
