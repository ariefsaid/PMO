import { useMutation, useQueryClient } from '@tanstack/react-query';
import { threeWayMatchRepository, type BillMatch } from '@/src/lib/repositories/threeWayMatch';
import { useOrgId } from '@/src/hooks/useOrgId';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/**
 * #2634: the Admin setting and the line editors. Kept apart from `useThreeWayMatch` (the ledger's read hooks) so a screen
 * that only reads a bill's match never needs these. Keys carry org_id.
 */

/** The saved setting; null when never saved (the match is off). */
export function useThreeWayMatchSettings() {
  return useOrgQuery(['three-way-match-settings'], () => threeWayMatchRepository.settings());
}

/** Bills held now, Admin only; read while the setting screen is open. */
export function useThreeWayMatchHeldCount(enabled: boolean) {
  return useOrgQuery(['three-way-match-held-count'], () => threeWayMatchRepository.heldCount(), { enabled });
}

export function useSaveThreeWayMatchSettings() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: (input: { enabled: boolean; quantityTolerancePct: number; amountTolerancePct: number }) => threeWayMatchRepository.saveSettings(input),
    onSuccess: (saved) => {
      qc.setQueryData(['three-way-match-settings', orgId], saved);
      void qc.invalidateQueries({ queryKey: ['three-way-match-held-count', orgId] });
      void qc.invalidateQueries({ queryKey: ['bill-match', orgId] });
    },
  });
}

/** What the editor starts from: the purchase's ordered items and the lines already recorded. */
export function useMatchLinesEditorData(kind: 'receipt' | 'bill', targetId: string, procurementId: string) {
  const items = useOrgQuery(['match-ordered-items', procurementId], () => threeWayMatchRepository.orderedItems(procurementId));
  const lines = useOrgQuery(['match-recorded-lines', kind, targetId], () => threeWayMatchRepository.recordedLines(kind, targetId));
  return { items, lines };
}

type SaveInput = { kind: 'receipt'; id: string; lines: Array<{ itemId: string; quantity: number }> } | { kind: 'bill'; id: string; lines: Array<{ itemId: string; quantity: number; rate: number }> };
/** Record receipt or bill lines; every bill's match (and so the purchase's payment gate) is read again. */
export function useSaveMatchLines() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    // A bill's save returns the match as it now stands (so a cleared hold shows at once); a receipt's returns null.
    mutationFn: async (input: SaveInput): Promise<BillMatch | null> => {
      if (input.kind === 'bill') return threeWayMatchRepository.recordBillLines(input.id, input.lines);
      await threeWayMatchRepository.recordReceiptLines(input.id, input.lines);
      return null;
    },
    onSuccess: (_r, input) => {
      void qc.invalidateQueries({ queryKey: ['bill-match', orgId] });
      void qc.invalidateQueries({ queryKey: ['match-recorded-lines', orgId, input.kind, input.id] });
    },
  });
}
