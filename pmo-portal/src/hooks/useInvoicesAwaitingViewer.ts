import { useMemo } from 'react';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useRevenueMode } from './useRevenueMode';
import { useNativeDraftInvoices } from './useRevenue';
import { useDraftInvoices } from './useRevenue';
import { useExternalDomainOwnership } from './useExternalDomainOwnership';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

export interface InvoicesAwaitingViewer {
  /** PMO drafts the viewer may approve — never their own (the RPC is the authority). */
  rows: SalesInvoiceRow[];
  /** The viewer may approve invoices but ownership or the drafts are still loading. */
  isPending: boolean;
  isError: boolean;
  /** Whether PMO-native or Odoo invoice approvals are active for this viewer. */
  enabled?: boolean;
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
  const ownership = useExternalDomainOwnership();
  const revenueTier = ownership.data?.find((row) => row.domain === 'revenue')?.externalTier;
  const canApprove = may('transition', 'salesInvoice');
  const nativeActive = canApprove && mode === 'native';
  const odooActive = canApprove && revenueTier === 'odoo';
  const native = useNativeDraftInvoices(nativeActive);
  const odoo = useDraftInvoices(odooActive);
  const active = nativeActive || odooActive;
  const data = nativeActive ? native.data : odooActive ? odoo.data : undefined;
  const isPending = nativeActive ? native.isPending : odooActive && odoo.isPending;
  const isError = nativeActive ? native.isError : odooActive && odoo.isError;
  const refetch = nativeActive ? native.refetch : odoo.refetch;

  const rows = useMemo(
    () => (active ? data ?? [] : []).filter((inv) => (!odooActive || !inv.pmo_native)).filter((inv) =>
      may('submit_sales_invoice', 'salesInvoice', {
        currentUserId: userId,
        record: { author_id: inv.author_user_id, author_ids: inv.author_user_ids },
      })),
    [active, data, may, userId, odooActive],
  );

  return {
    rows,
    isPending: canApprove && (mode === undefined || (ownership.data === undefined && !ownership.isError) || (active && isPending)),
    isError: active && isError,
    enabled: active,
    refetch,
  };
}
