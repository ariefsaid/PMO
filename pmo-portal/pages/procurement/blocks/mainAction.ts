import type { TFunction } from 'i18next';
import { can } from '@/src/auth/policy';
import { isLegalTransition, canCancel, type ProcurementStatus } from '@/src/lib/db/procurementLifecycle';


// ---------------------------------------------------------------------------
// Role gates for cosmetic display (FR-PROC-006, OD-PROC-1 matrix, AC-805).
// The RPC is the real authority — this is display-only. The matrix is BYTE-PRESERVED;
// ADR-0016 re-points it at the REAL JWT role and routes the entity-level role membership
// through the shared policy `can()`:
//   - approve/reject membership = can('transition','procurement') → Admin·Exec·PM·Finance
//   - sourcing/select-quote membership = can('create','quotation') → Admin·PM·Finance
// The two procurement-STAGE-specific gates below are not entity-level RBAC (they encode a
// stage role like "who confirms receipt"), so they remain documented local constants.
// ---------------------------------------------------------------------------
export const canApproveReject = (role: string) =>
  can('transition', 'procurement', { realRole: role as never });
export const canSource = (role: string) => can('create', 'quotation', { realRole: role as never });
export const RECEIPT_ROLES = new Set(['Project Manager', 'Admin']); // requester also allowed — handled below
export const INVOICE_PAY_ROLES = new Set(['Finance', 'Admin']);

export type ActionVariant = 'primary' | 'success' | 'destructive' | 'outline';
export interface ProcurementAction { to: ProcurementStatus; label: string; variant: ActionVariant }

/**
 * Returns the list of (from→to) transitions that should be shown to this role.
 * Cosmetic only — the RPC enforces for real (AC-805, FR-PROC-006); it mirrors
 * transition_procurement's matrix (submit: the requester, or a real Admin).
 */
export function allowedActions(
  status: ProcurementStatus,
  role: string,
  isRequester: boolean,
  isApprover: boolean,
  // The labels below are rendered on the stage buttons AND restated in the confirm dialogs, so
  // they are message strings, not data. `t` is threaded in rather than the labels being turned
  // into keys resolved at the call site: `i18next-parser` extracts literal keys only, so a
  // `t(action.labelKey)` would be invisible to the en-side completeness gate (FR-L10N-042a).
  t: TFunction,
  /** #803: false when the request is routed to named approvers who do not include the viewer. */
  routeAllows: boolean = true,
  /** FR-PFE-005: a payment was recorded at an earlier step (payment-first). */
  hasPaymentRecord: boolean = false,
  /** D2 review C3: Mark as Paid needs something to pay — a line item or a recorded amount. */
  hasValue: boolean = true,
): ProcurementAction[] {
  const actions: ProcurementAction[] = [];

  const legal = (to: ProcurementStatus) => isLegalTransition(status, to);

  // Draft → Requested: the requester, any role; Admin break-glass (OD-PROC-1, FR-PROC-005)
  if (legal('Requested') && (isRequester || role === 'Admin')) {
    actions.push({ to: 'Requested', label: t('procurementDetail.action.submitRequest', 'Submit for approval'), variant: 'primary' });
  }

  // Requested → Approved / Rejected: PM/Finance/Exec/Admin and NOT the requester (SoD-a) (FR-PROC-006)
  if (legal('Approved') && canApproveReject(role) && !isRequester && routeAllows) {
    // Approve is the single per-screen CTA at this stage → the One-Blue `primary`
    // (polish #1). It previously read solid `success` green, which competed with
    // the system's one interactive blue (DESIGN.md One-Blue Rule). Reject stays a
    // quiet outline so only one affordance carries weight.
    actions.push({ to: 'Approved', label: t('procurementDetail.action.approve', 'Approve'), variant: 'primary' });
  }
  if (legal('Rejected') && canApproveReject(role) && !isRequester && routeAllows) {
    actions.push({ to: 'Rejected', label: t('procurementDetail.action.reject', 'Reject'), variant: 'destructive' });
  }

  // Rejected → Draft: requester rework (FR-PROC-007)
  if (legal('Draft') && isRequester) {
    actions.push({ to: 'Draft', label: t('procurementRecord:action.rework', 'Rework'), variant: 'outline' });
  }

  // Approved → Vendor Quoted / Ordered (skip): PM/Finance/Admin (FR-PROC-008)
  // D7 (AC-IXD-PROC-W5-1b): at Approved, "Request Vendor Quotes" is the canonical
  // primary (OD-W5-2 — quoting first is the conventional lower-risk path). "Generate
  // Purchase Order" is a valid skip-to-PO path but is demoted to `outline` so only
  // ONE blue appears per stage (DESIGN.md One-Blue Rule). BOTH remain clickable.
  if (legal('Vendor Quoted') && canSource(role)) {
    actions.push({ to: 'Vendor Quoted', label: t('procurementRecord:action.requestQuotes', 'Request quotations'), variant: 'primary' });
  }
  if (legal('Ordered') && canSource(role) && status === 'Approved') {
    // outline (not primary) — see D7 note above
    actions.push({ to: 'Ordered', label: t('procurementDetail.action.generatePurchaseOrder', 'Generate Purchase Order'), variant: 'outline' });
  }

  // Vendor Quoted → Quote Selected: PM/Finance/Admin
  if (legal('Quote Selected') && canSource(role)) {
    actions.push({ to: 'Quote Selected', label: t('procurementDetail.action.selectQuote', 'Compare and select a quote'), variant: 'primary' });
  }

  // Quote Selected → Ordered: PM/Finance/Admin. status is exactly one value, so
  // legal('Ordered') holds for at most one of these branches — they cannot collide.
  if (legal('Ordered') && canSource(role) && status === 'Quote Selected') {
    actions.push({ to: 'Ordered', label: t('procurementDetail.action.generatePurchaseOrder', 'Generate Purchase Order'), variant: 'primary' });
  }

  // Ordered → Received: requester or PM (FR-PROC-008)
  if (legal('Received') && (isRequester || RECEIPT_ROLES.has(role))) {
    actions.push({ to: 'Received', label: t('procurementDetail.action.confirmReceipt', 'Confirm Receipt'), variant: 'primary' });
  }

  // Received → Vendor Invoiced: Finance only (FR-PROC-009)
  if (legal('Vendor Invoiced') && INVOICE_PAY_ROLES.has(role)) {
    actions.push({ to: 'Vendor Invoiced', label: t('procurementDetail.action.markVendorInvoiced', 'Record supplier invoice'), variant: 'primary' });
  }

  // Vendor Invoiced → Paid: Finance only, AND not the user who approved the
  // request. SoD-b is enforced server-side and ALWAYS rejects pay-by-approver,
  // so offering it cosmetically produced a "click that does nothing" — gate it.
  if (legal('Paid') && INVOICE_PAY_ROLES.has(role) && !isApprover && hasValue) {
    actions.push({ to: 'Paid', label: t('procurementDetail.action.markAsPaid', 'Mark as Paid'), variant: 'primary' });
  }

  // FR-PFE-005 payment-first: a recorded (scheduled) payment can be paid from an earlier step. Same role and SoD rule as above.
  if (hasPaymentRecord && ['Draft', 'Approved', 'Quote Selected', 'Ordered', 'Received'].includes(status)
      && INVOICE_PAY_ROLES.has(role) && !isApprover && hasValue) {
    actions.push({ to: 'Paid', label: t('procurementDetail.action.markAsPaid', 'Mark as Paid'), variant: 'primary' });
  }

  // Cancel: subject to canCancel boundary (FR-PROC-009, OD-PROC-B). The page
  // action reads "Cancel request" (verb + object) so it never reads as a bare
  // "Cancel" that could be mistaken for dismissing the screen (polish #2).
  if (legal('Cancelled') && canCancel(role, isRequester, status)) {
    actions.push({ to: 'Cancelled', label: t('procurementDetail.action.cancelRequest', 'Cancel procurement'), variant: 'destructive' });
  }

  return actions;
}

/**
 * D8 (AC-IXD-PROC-W5-1d): Sort actions so the visual/tab order is always:
 *   primary → outline → destructive (Cancel/Reject last, never above the primary)
 * This is a deliberate, fixed order — not relying on push-order + flex-wrap.
 * Weight: primary=0, outline/success=1, destructive=2.
 */
export function sortActions(
  actions: ProcurementAction[],
): ProcurementAction[] {
  const weight = (v: ActionVariant): number => {
    if (v === 'primary') return 0;
    if (v === 'destructive') return 2;
    return 1; // outline, success
  };
  return [...actions].sort((a, b) => weight(a.variant) - weight(b.variant));
}

/**
 * The one filled action a procurement's current state offers this viewer, with its plain-language label.
 * The record page header, its phone action bar and the list drawer all show this same action (B4).
 */
export function stateMainAction(
  status: ProcurementStatus,
  actions: readonly ProcurementAction[],
  t: TFunction,
): { transition: ProcurementAction; label: string } | undefined {
  const actionFor = (to: ProcurementStatus) => actions.find((action) => action.to === to);
  const transition = status === 'Draft'
    ? actionFor('Requested')
    : status === 'Requested'
      ? actionFor('Approved')
      : status === 'Approved'
        ? actionFor('Ordered') ?? actionFor('Vendor Quoted')
        : status === 'Quote Selected'
          ? actionFor('Ordered')
          : status === 'Rejected'
            ? actionFor('Draft')
            : status === 'Vendor Quoted'
              ? actionFor('Quote Selected')
              : status === 'Ordered'
                ? actionFor('Received')
                : status === 'Received'
                  ? actionFor('Vendor Invoiced')
                  : status === 'Vendor Invoiced'
                    ? actionFor('Paid')
                    : undefined;
  if (!transition) return undefined;
  const label = status === 'Draft' ? t('procurementRecord:action.submit', 'Submit for approval')
    : (status === 'Approved' || status === 'Quote Selected') && transition.to === 'Ordered' ? t('procurementRecord:action.recordOrder', 'Record order')
      : status === 'Vendor Quoted' ? t('procurementRecord:action.chooseQuote', 'Choose quote')
        : status === 'Rejected' ? t('procurementRecord:action.rework', 'Rework')
          : status === 'Ordered' ? t('procurementRecord:action.recordReceipt', 'Record receipt')
            : status === 'Received' ? t('procurementRecord:action.recordInvoice', 'Record supplier invoice')
              : status === 'Vendor Invoiced' ? t('procurementRecord:action.recordPayment', 'Record payment')
                : transition.label;
  return { transition, label };
}
