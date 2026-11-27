import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { useOverdueInvoiceFacts } from './useRevenue';
import { clientInvoiceOverdueDays } from '@/src/lib/repositories/revenueDisplay';

/** The rail derives its badge from the dashboard's shared invoice facts. */
export function useOverdueInvoiceCount(enabled = true) {
  const orgDay = useFxOrgDay(enabled);
  const facts = useOverdueInvoiceFacts(enabled);
  return { ...facts, data: facts.data && orgDay.day
    ? facts.data.filter(row => clientInvoiceOverdueDays(row, orgDay.day!) !== null).length
    : undefined };
}
