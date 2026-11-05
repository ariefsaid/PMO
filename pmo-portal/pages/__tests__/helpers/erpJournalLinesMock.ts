// Shared stub for `@/src/hooks/useErpJournalLines` in tests that render the whole ProcurementDetails page
// (the Documents tab mounts <AttachedJournalLines>, a react-query reader). Usage, at the start of a line:
//   vi.mock('@/src/hooks/useErpJournalLines', () => import('@/pages/__tests__/helpers/erpJournalLinesMock'));
// No attached lines: the section renders nothing, exactly as for a purchase without journal entries.
import { vi } from 'vitest';

export const usePurchaseJournalLines = () => ({ data: [], isError: false, isPending: false });
export const useProjectJournalLines = () => ({ data: [], isError: false, isPending: false });
export const useDetachJournalLine = () => ({ mutateAsync: vi.fn(), isPending: false });
export const useAttachJournalLines = () => ({ mutateAsync: vi.fn(), isPending: false });
