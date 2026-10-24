// Shared stub for `@/src/hooks/useProcurementGates` in tests that render the whole ProcurementDetails page.
// Usage, at the start of a line:
//   vi.mock('@/src/hooks/useProcurementGates', () => import('@/pages/__tests__/helpers/procurementGatesMock'));
// Every purchase rule off, as for an org that never turned one on.
export const PROCUREMENT_GATES_KEY = 'org-procurement-gates';
export const useProcurementGates = () => ({
  data: { request_before_order: false, approval_before_order: false, approval_before_payment: false, receipt_before_invoice: false },
  isError: false,
  isPending: false,
});
