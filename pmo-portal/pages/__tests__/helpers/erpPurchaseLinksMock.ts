// Shared stub for `@/src/hooks/useErpPurchaseLinks` in tests that render the whole ProcurementDetails page
// (the Documents tab mounts <LinkedErpDocuments>, a react-query reader). Usage, at the start of a line:
//   vi.mock('@/src/hooks/useErpPurchaseLinks', () => import('@/pages/__tests__/helpers/erpPurchaseLinksMock'));
// No linked documents, no pending state: the section renders nothing, exactly as for a purchase without ERP documents.
import { vi } from 'vitest';

export const useLinkedErpDocuments = () => ({ data: [], isError: false, isPending: false });
export const useUnlinkErpDocument = () => ({ mutateAsync: vi.fn(), isPending: false });
export const useLinkErpDocuments = () => ({ mutateAsync: vi.fn(), isPending: false });
