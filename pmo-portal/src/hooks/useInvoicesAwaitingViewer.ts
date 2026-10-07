import { useMemo } from 'react';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useRevenueMode } from './useRevenueMode';
import { useNativeDraftInvoices } from './useRevenue';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

export interface InvoicesAwaitingViewer {
  /** PMO drafts the viewer may approve — never their own (the RPC is the authority). */
  rows: SalesInvoiceRow[];
  /** The viewer may approve invoices but ownership or the drafts are still loading. */
  isPending: boolean;
  isError: boolean;
  refetch: () => unknown;
}

/**
 * #784 (FR-NAR-006, DD-NAR-12): the customer invoices awaiting the viewer on /approvals. One source for the section that
 * lists them and the page that counts them, so "all caught up" can never sit under a waiting invoice. Empty for a viewer
 * who cannot approve (the transition permission — approving IS the Draft→Unpaid transition) or once an ERP owns revenue.
 */
export function useInvoicesAwaitingViewer(): InvoicesAwaitingViewer {
  const may = usePermission();
  const userId = useAuth().currentUser?.id;
  const mode = useRevenueMode();
  const canApprove = may('transition', 'salesInvoice');
  const active = canApprove && mode === 'native';
  const { data, isPending, isError, refetch } = useNativeDraftInvoices(active);

  const rows = useMemo(
    () => (active ? data ?? [] : []).filter((inv) =>
      may('submit_sales_invoice', 'salesInvoice', {
        currentUserId: userId,
        record: { author_id: inv.author_user_id, author_ids: inv.author_user_ids },
      })),
    [active, data, may, userId],
  );

  return {
    rows,
    isPending: canApprove && (mode === undefined || (active && isPending)),
    isError: active && isError,
    refetch,
  };
}
