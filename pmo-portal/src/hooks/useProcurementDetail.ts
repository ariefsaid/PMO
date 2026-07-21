import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import {
  IDLE_PENDING_PUSH,
  beginPush,
  pendingPushAfterWrite,
  type PendingPushState,
} from '@/src/lib/adapterSeam/pendingPush';
import {
  getProcurementDetail,
  // task FIX-1 (Discover CRITICAL 1): captureVendorInvoice is the atomic case-transition + invoice
  // RPC (`capture_vendor_invoice`) — it REUSES transition_procurement's SoD guard (harden #2 above),
  // so it is a case-aggregate write, not a per-doctype ERP command. Per FR-ENA-101/073 the case
  // aggregate stays PMO-derived even on a flipped org (same rule as `transition`, task 4.9), so this
  // stays on the direct DAL — it has no repository seam entry and none is added here.
  captureVendorInvoice as dalCaptureVendorInvoice,
  ProcurementError,
  type ProcurementDetail,
  type ProcurementStatus,
  type ProcurementReceiptRow,
  type ProcurementInvoiceRow,
} from '@/src/lib/db/procurementLifecycle';
import type { Tables } from '@/src/lib/supabase/database.types';
import type { CommandIntent } from '@/src/lib/repositories/types';

// ---------------------------------------------------------------------------
// Query key factory — org-scoped (mirrors useBudget pattern, AC-816)
// ---------------------------------------------------------------------------

const procurementDetailKey = (orgId: string | undefined, id: string | undefined) =>
  ['procurement', orgId, id] as const;

// ---------------------------------------------------------------------------
// Read hook (C1)
// ---------------------------------------------------------------------------

/**
 * Fetches the full procurement detail (header + quotations + receipts + invoices).
 * Cache key is org-scoped: ['procurement', orgId, id] (AC-816).
 * Disabled when orgId or id are falsy.
 */
export function useProcurementDetail(id: string | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;

  return useQuery<ProcurementDetail>({
    queryKey: procurementDetailKey(orgId, id),
    queryFn: () => getProcurementDetail(id!),
    enabled: Boolean(orgId && id),
  });
}

// ---------------------------------------------------------------------------
// Mutation hook (C2) — transition + child-creation; each invalidates detail key
// ---------------------------------------------------------------------------

/**
 * All procurement lifecycle mutations for a single procurement.
 * Each mutation invalidates ['procurement', orgId, id] on success (AC-816).
 *
 * task FIX-1 (Discover CRITICAL 1): createQuotation/createReceipt/createInvoice now call the
 * `repositories.procurement.*` seam (not the DAL directly) — Slice 1 already wired that seam's
 * `routeDomainWrite('procurement')` guard, so a flipped org's write now genuinely dispatches
 * externally instead of silently local-writing with a false success. `transition` also moves onto
 * the same seam for architectural consistency (ADR-0017) — `repositories.procurement.transition`
 * carries NO routing guard and always stays on the direct DAL (task 4.9's ruling, FR-ENA-101/073).
 */
export function useProcurementMutations(id: string) {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;

  const invalidateDetail = () => {
    queryClient.invalidateQueries({ queryKey: procurementDetailKey(orgId, id) });
  };

  // The shared pending-push state for this procurement's record-creation writes (quotation/GR/VI —
  // the ones that actually route external per FR-ENA-131). Single (not per-id) because only one
  // capture affordance is open at a time on the detail page. Stays idle for PMO-owned orgs.
  const [pendingPush, setPendingPush] = useState<PendingPushState>(IDLE_PENDING_PUSH);
  const isExternal = () => routeDomainWrite('procurement') === 'external';

  // Error type is ProcurementError so consumers can read `.code` (P0001 /
  // 42501) type-safely and classify the toast (no code-dropping).
  const transition = useMutation<void, ProcurementError, { to: ProcurementStatus; notes?: string }>({
    mutationFn: ({ to, notes }) => repositories.procurement.transition(id, to, notes),
    onSuccess: invalidateDetail,
  });

  const createQuotation = useMutation<
    Tables<'procurement_quotations'>,
    ProcurementError,
    { vendorId: string; totalAmount: number; receivedDate: string; intent?: CommandIntent }
  >({
    mutationFn: ({ vendorId, totalAmount, receivedDate, intent }) =>
      repositories.procurement.createQuotation(id, vendorId, totalAmount, receivedDate, intent),
    onMutate: () => {
      if (isExternal()) setPendingPush(beginPush(IDLE_PENDING_PUSH));
    },
    onSuccess: () => {
      invalidateDetail();
      if (isExternal()) setPendingPush(pendingPushAfterWrite('external', { ok: true }));
    },
    onError: (err) => {
      if (isExternal()) setPendingPush(pendingPushAfterWrite('external', { ok: false, err }));
    },
  });

  const createReceipt = useMutation<
    ProcurementReceiptRow,
    ProcurementError,
    { status: 'Partial' | 'Complete'; receiptDate: string; referenceNumber?: string | null; intent?: CommandIntent }
  >({
    mutationFn: ({ status, receiptDate, referenceNumber, intent }) =>
      repositories.procurement.createReceipt(id, status, receiptDate, referenceNumber, intent),
    onMutate: () => {
      if (isExternal()) setPendingPush(beginPush(IDLE_PENDING_PUSH));
    },
    onSuccess: () => {
      invalidateDetail();
      if (isExternal()) setPendingPush(pendingPushAfterWrite('external', { ok: true }));
    },
    onError: (err) => {
      if (isExternal()) setPendingPush(pendingPushAfterWrite('external', { ok: false, err }));
    },
  });

  const createInvoice = useMutation<
    ProcurementInvoiceRow,
    ProcurementError,
    { status: 'Received' | 'Scheduled' | 'Paid'; invoiceDate: string; referenceNumber?: string | null; amount?: number | null; intent?: CommandIntent }
  >({
    mutationFn: ({ status, invoiceDate, referenceNumber, amount, intent }) =>
      repositories.procurement.createInvoice(id, status, invoiceDate, referenceNumber, amount, intent),
    onMutate: () => {
      if (isExternal()) setPendingPush(beginPush(IDLE_PENDING_PUSH));
    },
    onSuccess: () => {
      invalidateDetail();
      if (isExternal()) setPendingPush(pendingPushAfterWrite('external', { ok: true }));
    },
    onError: (err) => {
      if (isExternal()) setPendingPush(pendingPushAfterWrite('external', { ok: false, err }));
    },
  });

  // harden #2: atomic VI capture — transition→Vendor Invoiced + invoice-create + status-event in ONE
  // RPC (SoD reused, not bypassed). Replaces the old two-write FE sequence that could advance the
  // case with no invoice on a partial failure. Case-aggregate write — stays PMO-only (see the import
  // comment above); never routes external, so it never touches `pendingPush`.
  const captureVendorInvoice = useMutation<
    ProcurementInvoiceRow,
    ProcurementError,
    {
      status: 'Received' | 'Scheduled';
      invoiceDate: string;
      referenceNumber?: string | null;
      amount?: number | null;
      notes?: string | null;
    }
  >({
    mutationFn: ({ status, invoiceDate, referenceNumber, amount, notes }) =>
      dalCaptureVendorInvoice(id, status, invoiceDate, referenceNumber, amount, notes),
    onSuccess: invalidateDetail,
  });

  return { transition, createQuotation, createReceipt, createInvoice, captureVendorInvoice, pendingPush };
}
