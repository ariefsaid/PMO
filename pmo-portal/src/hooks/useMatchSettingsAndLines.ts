import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { threeWayMatchRepository, type BillMatch } from '@/src/lib/repositories/threeWayMatch';

/**
 * #2634: the Admin setting and the line editors. Kept apart from `useThreeWayMatch` (the ledger's read hooks) so a screen
 * that only reads a bill's match never needs these. Keys carry org_id.
 */

/** The saved setting; null when never saved (the match is off). */
export function useThreeWayMatchSettings() {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['three-way-match-settings', orgId], queryFn: () => threeWayMatchRepository.settings(), enabled: Boolean(orgId) });
}

/** Bills held now, Admin only; read while the setting screen is open. */
export function useThreeWayMatchHeldCount(enabled: boolean) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['three-way-match-held-count', orgId], queryFn: () => threeWayMatchRepository.heldCount(), enabled: enabled && Boolean(orgId) });
}

export function useSaveThreeWayMatchSettings() {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
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
  const orgId = useAuth().currentUser?.org_id;
  const items = useQuery({ queryKey: ['match-ordered-items', orgId, procurementId], queryFn: () => threeWayMatchRepository.orderedItems(procurementId), enabled: Boolean(orgId) });
  const lines = useQuery({ queryKey: ['match-recorded-lines', orgId, kind, targetId], queryFn: () => threeWayMatchRepository.recordedLines(kind, targetId), enabled: Boolean(orgId) });
  return { items, lines };
}

type SaveInput = { kind: 'receipt'; id: string; lines: Array<{ itemId: string; quantity: number }> } | { kind: 'bill'; id: string; lines: Array<{ itemId: string; quantity: number; rate: number }> };
/** Record receipt or bill lines; every bill's match (and so the purchase's payment gate) is read again. */
export function useSaveMatchLines() {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
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
