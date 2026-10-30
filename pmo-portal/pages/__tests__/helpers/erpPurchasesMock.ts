// Shared stub for `@/src/hooks/useErpPurchases` in tests that render the whole ProcurementDetails page.
// Usage, at the start of a line:
//   vi.mock('@/src/hooks/useErpPurchases', () => import('@/pages/__tests__/helpers/erpPurchasesMock'));
export const useErpOrphans = () => ({ data: [], isError: false, isPending: false });
export const useErpPurchases = () => ({ data: [], isError: false, isPending: false });
export const useHasErpPurchases = () => ({ data: false });
