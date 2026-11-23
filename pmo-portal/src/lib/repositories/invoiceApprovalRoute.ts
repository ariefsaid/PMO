import { getInvoiceApprovalRoute, type InvoiceApprovalRoute } from '@/src/lib/db/invoiceApprovalRoute';
import { wrap } from './repositoryErrors';

/**
 * Standalone typed repository for the customer-invoice approval route (ADR-0017 seam). It is deliberately not
 * folded into the shared `repositories` barrel: the route answer is caller-scoped and only the invoice record
 * screen consumes it.
 */
export interface InvoiceApprovalRouteRepository {
  get(invoiceId: string): Promise<InvoiceApprovalRoute>;
}

export const invoiceApprovalRouteRepository: InvoiceApprovalRouteRepository = {
  get: (invoiceId) => wrap(() => getInvoiceApprovalRoute(invoiceId)),
};
