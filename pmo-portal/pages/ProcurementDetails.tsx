import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  PageHeader,
  Card,
  CardHead,
  CardPad,
  Button,
  StatusPill,
  LifecycleStepper,
  GateNotice,
  StatTiles,
  ListState,
  Icon,
  ConfirmDialog,
  useToast,
  type StatTile,
} from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { useProcurementDetail, useProcurementMutations } from '@/src/hooks/useProcurementDetail';
import {
  useProcurementCrudMutations,
  useProcurementDocuments,
} from '@/src/hooks/useProcurementCrud';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { can } from '@/src/auth/policy';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { formatCurrency } from '@/src/lib/format';
import { LineItemsSection } from './procurement/LineItemsSection';
import { QuotationsSection } from './procurement/QuotationsSection';
import { ProcurementDocumentsSection } from './procurement/ProcurementDocumentsSection';
import { ProcurementHeaderEdit } from './procurement/ProcurementHeaderEdit';
import {
  isLegalTransition,
  canCancel,
  type ProcurementStatus,
  type ProcurementDetail,
} from '@/src/lib/db/procurementLifecycle';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import {
  lifecycleSteps,
  pillVariantForStatus,
  stageLabelForStatus,
  selectedQuotation,
  toastStateLabel,
} from '../components/procurement';

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
const canApproveReject = (role: string) =>
  can('transition', 'procurement', { realRole: role as never });
const canSource = (role: string) => can('create', 'quotation', { realRole: role as never });
const RECEIPT_ROLES = new Set(['Project Manager', 'Admin']); // requester also allowed — handled below
const INVOICE_PAY_ROLES = new Set(['Finance', 'Admin']);

type ActionVariant = 'primary' | 'success' | 'destructive' | 'outline';

/** A staged, not-yet-committed mutation awaiting the ConfirmDialog. */
type PendingConfirm =
  | {
      kind: 'transition';
      to: ProcurementStatus;
      title: string;
      /** Per-target dialog body. The kept financial confirms (Approve / Mark as Paid)
       *  RESTATE the amount + project + requester here (OD-UX-1, confirm against the money). */
      description: React.ReactNode;
      confirmLabel: string;
      /** Dismiss-button label; defaults to "Cancel" but the PR-cancel flow uses
       *  "Keep request" so the dismiss never reads as "cancel the cancellation". */
      cancelLabel?: string;
      tone: 'default' | 'destructive';
    }
  | {
      kind: 'createGR';
      status: 'Partial' | 'Complete';
      receiptDate: string;
    }
  | {
      kind: 'createVI';
      /** N1: Paid removed — Mark as Paid is the sole PR→Paid authority (AC-W3-N1). */
      status: 'Received' | 'Scheduled';
      invoiceDate: string;
    };

/**
 * Returns the list of (from→to) transitions that should be shown to this role.
 * Cosmetic only — the RPC enforces for real (AC-805, FR-PROC-006). PRESERVED:
 * the matrix below is byte-identical to the prior implementation, only the
 * button-variant vocabulary maps onto the design-system Button variants.
 */
function allowedActions(
  status: ProcurementStatus,
  role: string,
  isRequester: boolean,
  isApprover: boolean,
): { to: ProcurementStatus; label: string; variant: ActionVariant }[] {
  const actions: { to: ProcurementStatus; label: string; variant: ActionVariant }[] = [];

  const legal = (to: ProcurementStatus) => isLegalTransition(status, to);

  // Draft → Requested: any member (FR-PROC-005)
  if (legal('Requested')) {
    actions.push({ to: 'Requested', label: 'Submit Request', variant: 'primary' });
  }

  // Requested → Approved / Rejected: PM/Finance/Exec/Admin and NOT the requester (SoD-a) (FR-PROC-006)
  if (legal('Approved') && canApproveReject(role) && !isRequester) {
    // Approve is the single per-screen CTA at this stage → the One-Blue `primary`
    // (polish #1). It previously read solid `success` green, which competed with
    // the system's one interactive blue (DESIGN.md One-Blue Rule). Reject stays a
    // quiet outline so only one affordance carries weight.
    actions.push({ to: 'Approved', label: 'Approve', variant: 'primary' });
  }
  if (legal('Rejected') && canApproveReject(role) && !isRequester) {
    actions.push({ to: 'Rejected', label: 'Reject', variant: 'destructive' });
  }

  // Rejected → Draft: requester rework (FR-PROC-007)
  if (legal('Draft') && isRequester) {
    actions.push({ to: 'Draft', label: 'Rework (Back to Draft)', variant: 'outline' });
  }

  // Approved → Vendor Quoted / Ordered (skip): PM/Finance/Admin (FR-PROC-008)
  if (legal('Vendor Quoted') && canSource(role)) {
    actions.push({ to: 'Vendor Quoted', label: 'Request Vendor Quotes', variant: 'primary' });
  }
  if (legal('Ordered') && canSource(role) && status === 'Approved') {
    actions.push({ to: 'Ordered', label: 'Generate Purchase Order', variant: 'primary' });
  }

  // Vendor Quoted → Quote Selected: PM/Finance/Admin
  if (legal('Quote Selected') && canSource(role)) {
    actions.push({ to: 'Quote Selected', label: 'Select Quote', variant: 'primary' });
  }

  // Quote Selected → Ordered: PM/Finance/Admin. status is exactly one value, so
  // legal('Ordered') holds for at most one of these branches — they cannot collide.
  if (legal('Ordered') && canSource(role) && status === 'Quote Selected') {
    actions.push({ to: 'Ordered', label: 'Generate Purchase Order', variant: 'primary' });
  }

  // Ordered → Received: requester or PM (FR-PROC-008)
  if (legal('Received') && (isRequester || RECEIPT_ROLES.has(role))) {
    actions.push({ to: 'Received', label: 'Confirm Receipt', variant: 'primary' });
  }

  // Received → Vendor Invoiced: Finance only (FR-PROC-009)
  if (legal('Vendor Invoiced') && INVOICE_PAY_ROLES.has(role)) {
    actions.push({ to: 'Vendor Invoiced', label: 'Mark Vendor Invoiced', variant: 'primary' });
  }

  // Vendor Invoiced → Paid: Finance only, AND not the user who approved the
  // request. SoD-b is enforced server-side and ALWAYS rejects pay-by-approver,
  // so offering it cosmetically produced a "click that does nothing" — gate it.
  if (legal('Paid') && INVOICE_PAY_ROLES.has(role) && !isApprover) {
    actions.push({ to: 'Paid', label: 'Mark as Paid', variant: 'success' });
  }

  // Cancel: subject to canCancel boundary (FR-PROC-009, OD-PROC-B). The page
  // action reads "Cancel request" (verb + object) so it never reads as a bare
  // "Cancel" that could be mistaken for dismissing the screen (polish #2).
  if (legal('Cancelled') && canCancel(role, isRequester, status)) {
    actions.push({ to: 'Cancelled', label: 'Cancel request', variant: 'destructive' });
  }

  return actions;
}

/** Whether the effective role/identity may not yet advance — drives the SoD gate copy. */
function sodGateMessage(p: ProcurementDetail, role: string, isRequester: boolean): string | null {
  // Approval gate: a Requested PR awaiting a non-requester approver.
  if (p.status === 'Requested' && isRequester) {
    return `This request was raised by ${p.requested_by?.full_name ?? 'you'}. A different user holding the Project-Manager, Finance, or Executive role must review it — the requester cannot self-approve their own request.`;
  }
  // Receipt gate: an Ordered PR where the viewer cannot confirm receipt.
  if (p.status === 'Ordered' && !(isRequester || RECEIPT_ROLES.has(role))) {
    return 'To advance from Purchase Order to Goods Receipt, the requester or a Project-Manager must confirm receipt of the goods.';
  }
  return null;
}

const ProcurementDetails: React.FC = () => {
  const { procurementId } = useParams<{ procurementId: string }>();
  // ADR-0016: write affordances gate on the REAL JWT role (not the impersonated
  // effectiveRole) so the buttons shown match what the RPC will actually honor.
  const { realRole } = useEffectiveRole();
  const may = usePermission();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const detailQuery = useProcurementDetail(procurementId);
  const mutations = useProcurementMutations(procurementId ?? '');
  const crud = useProcurementCrudMutations(procurementId ?? '');
  const docsQuery = useProcurementDocuments(procurementId);

  const [mutationError, setMutationError] = useState<string | null>(null);
  const [notesInput, setNotesInput] = useState('');
  const [showCreateGR, setShowCreateGR] = useState(false);
  const [showCreateVI, setShowCreateVI] = useState(false);
  // O3 (AC-W3-O3): "Mark Vendor Invoiced" inline capture — open when the user
  // clicks the action so invoice details are captured BEFORE the transition fires.
  const [showVICapture, setShowVICapture] = useState(false);
  // Confirm-before-write (owner rule): a transition action / GR / VI is staged
  // here and only commits when the ConfirmDialog's Confirm is pressed.
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  const data = detailQuery.data;

  // Back to the Procurement index — a plain navigate, no tab (AC-NAV-007). The
  // breadcrumb resolves the record title from the cached list in App.tsx.
  const goBack = () => navigate('/procurement');

  // ── Loading (AC-804, NFR-PROC-UI-001) ────────────────────────────────────
  if (detailQuery.isPending) {
    return (
      <>
        <BackBar label="Procurement" onBack={goBack} />
        <div data-testid="procurement-loading">
          <ListState variant="loading" rows={6} />
        </div>
      </>
    );
  }

  // ── No access / not found (polish #3) ────────────────────────────────────
  // A record the viewer cannot read under RLS comes back as a single-row miss
  // (PostgREST `PGRST116`), surfaced through the query's error. Rather than the
  // blank main area / generic transient-error state, render a clear, calm
  // "no access" notice (an Engineer reaching a PR that isn't theirs is the canonical
  // case). RLS is the real authority; this is the honest UI projection of it.
  const errCode = (detailQuery.error as { code?: string } | null | undefined)?.code;
  const isNoAccess = errCode === 'PGRST116';
  if (isNoAccess || (!detailQuery.isError && !data && !detailQuery.isPending)) {
    return (
      <>
        <BackBar label="Procurement" onBack={goBack} />
        {/* BackBar above already carries the "Back to Procurement" escape route,
            so the empty state does not repeat it (avoids a duplicate control). */}
        <div data-testid="procurement-no-access">
          <ListState
            variant="empty"
            icon="lock"
            title="You don't have access to this record"
            sub="This procurement request either doesn't exist or isn't visible to your role. If you raised it, open it from your own requests."
          />
        </div>
      </>
    );
  }

  // ── Error (AC-804) — a genuine transient failure (offer Retry) ───────────
  if (detailQuery.isError) {
    return (
      <>
        <BackBar label="Procurement" onBack={goBack} />
        <ListState
          variant="error"
          title="Couldn't load procurement"
          sub="Something went wrong fetching the procurement details."
          onRetry={() => detailQuery.refetch()}
        />
      </>
    );
  }

  const p: ProcurementDetail = data;
  const role = realRole ?? '';
  const isRequester = p.requested_by_id === currentUser?.id;
  // SoD-b: a user cannot pay a request they themselves approved.
  const isApprover = !!currentUser?.id && p.approved_by_id === currentUser.id;
  const actions = allowedActions(p.status, role, isRequester, isApprover);
  // AC-IXD-PROC-004 (PROC-004): the chosen quote that backs the "Selected quote" tile + the
  // QuotationsSection row pill. Centralized in components/procurement.ts so the binding holds
  // from the `Quote Selected` state onward through Paid — preferring the RPC's is_selected flag,
  // with a header-match fallback so the tile never silently reverts to "Pending" on flag drift.
  const selectedQuote = selectedQuotation(p.status, p.quotations, {
    total_value: p.total_value,
    vendor_id: p.vendor_id,
  });

  // ── CRUD affordance gating (clarity projection; RLS/RPC is the authority) ──
  const isDraft = p.status === 'Draft';
  const isRejected = p.status === 'Rejected';
  // Header edit: requester may edit while Draft/Rejected (entity edit + record-scope).
  // A8: Admin break-glass header edit while Draft/Rejected (RLS 0010 permits; edit is not an SoD axis).
  const canEditHeader =
    (isDraft || isRejected) && (isRequester || realRole === 'Admin') && may('edit', 'procurement');
  // Line items: requester OR PM/Finance/Admin while Draft (matches the 0015 RLS).
  const canEditItems = isDraft && (isRequester || may('edit', 'procItem'));
  // Quotations: sourcing roles add; select offered only while Vendor Quoted.
  const canAddQuote = may('create', 'quotation');
  const canSelectQuote = may('create', 'quotation') && p.status === 'Vendor Quoted';
  // Documents: Admin·Exec·PM·Finance manage; everyone else read-only.
  const canManageDocs = may('create', 'procDoc');

  // Shared classified-toast helper for the CRUD section mutations.
  const onMutationError = (err: unknown) => {
    const { headline, detail } = classifyMutationError(err);
    toast(headline, detail, 'warning');
  };
  const showNotes = actions.some((a) => a.to === 'Approved' || a.to === 'Rejected');
  const gateMsg = sodGateMessage(p, role, isRequester);
  // AC-IXD-PROC-005: a create affordance disappears once its stage has passed.
  // The GR form is offered only while goods are being received (Ordered |
  // Received); the VI form only while the request is at Vendor Invoiced. Neither
  // persists into the terminal Paid state under "No further actions". An already-
  // created GR/VI stays legible (read-only) via the document trail + stat tiles.
  // AC-AUTHZ: mirror the Ordered→Received transition authority from the RPC — requester OR PM,
  // plus Admin break-glass. Finance and Executive are NOT in the GR-creation role set (0018).
  const canShowGRForm =
    (p.status === 'Ordered' || p.status === 'Received') &&
    (isRequester || RECEIPT_ROLES.has(role));
  // O3 (review): the after-form is now the RECOVERY surface — it shows only when the PR is at
  // Vendor Invoiced but NO invoice record exists yet (e.g. the inline capture's transition
  // succeeded but the invoice-create failed). On the happy path the inline capture already created
  // the VI, so `p.invoices.length > 0` hides this form — no redundant second-create.
  const canShowVIForm =
    p.status === 'Vendor Invoiced' && (p.invoices?.length ?? 0) === 0 && INVOICE_PAY_ROLES.has(role);

  // ── Write policy (OD-UX-1): a transition gets a ConfirmDialog IFF it is
  //    consequential/financial — the set {Approve, Reject, Cancel, Mark-as-Paid}.
  //    Every other routine, reversible forward step (Submit Request, Request Vendor
  //    Quotes, Generate Purchase Order, Confirm Receipt, Mark Vendor Invoiced) is
  //    SINGLE-CLICK + a quiet success toast (no modal). The kept financial confirms
  //    RESTATE the amount + project + requester (confirm against the money — the
  //    contract-value SoD confirm is the template). PRESERVED RPC contract.
  const CONSEQUENTIAL_TARGETS = new Set<ProcurementStatus>([
    'Approved',
    'Rejected',
    'Cancelled',
    'Paid',
  ]);

  // The shared money/context line the kept financial confirms restate.
  const moneyContext = (
    <>
      <b>{formatCurrency(Number(p.total_value))}</b>
      {p.project?.name ? <> on <i>{p.project.name}</i></> : null}
      {p.requested_by?.full_name ? <>, requested by <i>{p.requested_by.full_name}</i></> : null}
    </>
  );

  const onActionClick = (action: { to: ProcurementStatus; label: string; variant: ActionVariant }) => {
    setMutationError(null);
    // O3 (AC-W3-O3): "Mark Vendor Invoiced" opens an inline capture so the invoice
    // reference + date + status are recorded BEFORE the transition fires (co-locate
    // capture with the action, mirroring the PipelineLens Mark-won pattern).
    if (action.to === 'Vendor Invoiced') {
      setShowVICapture(true);
      return;
    }
    if (!CONSEQUENTIAL_TARGETS.has(action.to)) {
      // Routine reversible forward step → commit directly, no dialog.
      void commitTransition(action.to);
      return;
    }
    const destructive = action.variant === 'destructive';
    const isCancel = action.to === 'Cancelled';
    // The commit verb (action.label is already "Cancel request" for the cancel
    // flow). The dismiss is "Keep request" ONLY for the cancel flow so the three
    // Cancels disambiguate (polish #2): page action "Cancel request" → confirm
    // "Cancel request" / "Keep request". Other destructive moves keep "Cancel".
    // Approve / Mark-as-Paid restate the money (task 10); Reject / Cancel are the
    // terminal destructive moves (the only other consequential targets).
    const description: React.ReactNode =
      action.to === 'Approved' ? (
        <>Approve {moneyContext}?</>
      ) : action.to === 'Paid' ? (
        <>Mark {moneyContext} as paid? This releases payment and cannot be undone.</>
      ) : (
        'This is a terminal action for this request and cannot be undone.'
      );
    setPendingConfirm({
      kind: 'transition',
      to: action.to,
      title: isCancel
        ? 'Cancel this request?'
        : destructive
          ? `${action.label} this request`
          : `${action.label}?`,
      description,
      confirmLabel: action.label,
      cancelLabel: isCancel ? 'Keep request' : undefined,
      tone: destructive ? 'destructive' : 'default',
    });
  };

  // ── Run a transition (shared by the routine single-click path and the confirm
  //    path). Toast is classified by the preserved RPC error code (sub-task b) so
  //    an illegal-stage / SoD failure reads as such instead of a silent no-op.
  const commitTransition = async (to: ProcurementStatus) => {
    try {
      await mutations.transition.mutateAsync({ to, notes: notesInput || undefined });
      setNotesInput('');
      setPendingConfirm(null);
      // AC-IXD-PROC-001: the toast names the SAME canonical state the badge will
      // show — not the raw enum value (button verb → badge → toast all agree).
      toast('Request updated', `Moved to ${toastStateLabel(to)}`, 'success');
    } catch (err) {
      setPendingConfirm(null);
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
      setMutationError(detail);
    }
  };

  // ── Commit the staged confirm (kept for the consequential set + GR/VI). Toast is
  //    classified by the preserved RPC error code (sub-task b) so an illegal-stage /
  //    SoD failure reads as such instead of a silent no-op.
  const commitConfirm = async () => {
    if (!pendingConfirm) return;
    setMutationError(null);
    if (pendingConfirm.kind === 'transition') {
      await commitTransition(pendingConfirm.to);
      return;
    }
    try {
      if (pendingConfirm.kind === 'createGR') {
        await mutations.createReceipt.mutateAsync({
          status: pendingConfirm.status,
          receiptDate: pendingConfirm.receiptDate,
        });
        setShowCreateGR(false);
        toast('Goods receipt recorded', undefined, 'success');
      } else {
        await mutations.createInvoice.mutateAsync({
          status: pendingConfirm.status,
          invoiceDate: pendingConfirm.invoiceDate,
        });
        setShowCreateVI(false);
        toast('Vendor invoice recorded', undefined, 'success');
      }
      setPendingConfirm(null);
    } catch (err) {
      // Close the confirm; surface the classified toast + keep the verbatim
      // inline error (forms keep redundant errors — that is correct).
      setPendingConfirm(null);
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
      setMutationError(detail);
    }
  };

  // O3 (AC-W3-O3): submit the inline VI capture — transition to Vendor Invoiced THEN create the
  // invoice record, sequenced from the FE (no RPC change). Calls the mutations DIRECTLY (not
  // commitTransition, whose catch swallows) so a failed transition exits the try BEFORE the invoice
  // is created. Exactly ONE toast: a combined success, or the classified failure (no contradictory
  // success-then-warning pair). The inline panel is closed on BOTH paths — on a partial failure
  // (transition OK, invoice fails) the PR is at Vendor Invoiced with no invoice, so the
  // `canShowVIForm` recovery after-form (gated on `p.invoices.length === 0`) is where it's finished.
  const submitVICapture = async (viStatus: 'Received' | 'Scheduled', invoiceDate: string) => {
    setMutationError(null);
    try {
      await mutations.transition.mutateAsync({ to: 'Vendor Invoiced', notes: notesInput || undefined });
      await mutations.createInvoice.mutateAsync({ status: viStatus, invoiceDate });
      setNotesInput('');
      setShowVICapture(false);
      toast('Vendor invoice recorded', `Moved to ${toastStateLabel('Vendor Invoiced')}`, 'success');
    } catch (err) {
      setShowVICapture(false);
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
      setMutationError(detail);
    }
  };

  const confirmInFlight =
    mutations.transition.isPending ||
    mutations.createReceipt.isPending ||
    mutations.createInvoice.isPending;

  const stats: StatTile[] = [
    {
      label: 'PR value',
      value: formatCurrency(Number(p.total_value)),
      sub: p.project?.name ?? undefined,
    },
    {
      // AC-IXD-PROC-004: once a quote is selected, the tile is bound to the
      // CHOSEN quotation — its amount + the selected vendor — through to Paid,
      // instead of reverting to "Pending — 0 received".
      label: 'Selected quote',
      value: selectedQuote ? formatCurrency(Number(selectedQuote.total_amount)) : 'Pending',
      sub: selectedQuote
        ? (p.vendor?.name ?? selectedQuote.vq_number ?? 'selected')
        : `${p.quotations.length} received`,
    },
    {
      label: 'PO committed',
      value: p.po_number ? formatCurrency(Number(p.total_value)) : 'Pending',
      sub: p.vendor?.name ?? (p.po_number ? undefined : 'no PO yet'),
    },
    {
      label: 'Goods received',
      value: p.receipts.length > 0 ? `${p.receipts.length} receipt${p.receipts.length > 1 ? 's' : ''}` : 'None yet',
      sub: p.receipts.length > 0 ? p.receipts[p.receipts.length - 1].status : 'awaiting delivery',
    },
  ];

  const meta = [
    p.code ? <span key="code" className="font-mono">{p.code}</span> : null,
    p.project?.name ? <span key="proj"> · {p.project.name}</span> : null,
    p.requested_by?.full_name ? <span key="req"> · requested by {p.requested_by.full_name}</span> : null,
  ].filter(Boolean);

  return (
    <div>
      {/* I7: no in-page BackBar on the success render — the top-bar breadcrumb
          (Procurement > record) owns wayfinding. BackBar is kept on the
          loading / error / not-found branches above, where there is no in-page
          header to orient from and the crumb shows only the raw id. */}
      <PageHeader
        name={p.title}
        iconColor={p.status === 'Paid' ? 'hsl(var(--success))' : 'hsl(var(--primary))'}
        icon={<Icon name="cart" />}
        status={
          <span data-testid="procurement-status-badge" data-status={p.status}>
            <StatusPill variant={pillVariantForStatus(p.status)}>
              {stageLabelForStatus(p.status)}
            </StatusPill>
          </span>
        }
        meta={meta.length ? <span>{meta}</span> : undefined}
      />

      {/* Full lifecycle node stepper (PR → VQ → PO → GR → VI → Paid) */}
      <Card className="mb-4">
        <CardPad>
          <LifecycleStepper
            variant="node"
            steps={lifecycleSteps(p.status, {
              pr_number: p.pr_number,
              vq_number: selectedQuote?.vq_number,
              po_number: p.po_number,
              gr_number: p.receipts[0]?.gr_number,
              vi_number: p.invoices[0]?.vi_number,
            })}
            aria-label="Procurement lifecycle"
          />
        </CardPad>
      </Card>

      {/* Draft-header edit (requester while Draft/Rejected) */}
      {canEditHeader && (
        <ProcurementHeaderEdit
          title={p.title}
          projectId={p.project_id}
          projectName={p.project?.name ?? null}
          vendorId={p.vendor_id}
          vendorName={p.vendor?.name ?? null}
          busy={crud.updateHeader.isPending}
          onError={onMutationError}
          onSave={async (patch) => {
            await crud.updateHeader.mutateAsync(patch);
            toast('Request updated', 'Header saved', 'success');
          }}
        />
      )}

      {/* SoD / readiness gate */}
      {gateMsg ? (
        <div className="mb-4">
          <GateNotice variant="blocked">
            <b>Separation-of-duties gate.</b> {gateMsg}
          </GateNotice>
        </div>
      ) : actions.length > 0 ? (
        <div className="mb-4">
          <GateNotice variant="ready">
            <b>Ready to advance.</b> You may move this request to its next lifecycle stage below.
          </GateNotice>
        </div>
      ) : null}

      {/* Stat strip */}
      <StatTiles tiles={stats} className="mb-4" />

      {/* Action bar (AC-805) */}
      <Card className="mb-4">
        <CardPad className="flex flex-col gap-3">
          {showNotes && (
            <div className="flex max-w-md flex-col gap-1">
              <label htmlFor="procurement-notes-input" className="text-[12px] font-semibold text-muted-foreground">
                Notes <span className="font-normal">(optional)</span>
              </label>
              <textarea
                id="procurement-notes-input"
                data-testid="procurement-notes-input"
                rows={2}
                value={notesInput}
                onChange={(e) => setNotesInput(e.target.value)}
                placeholder="Add a note for the approval or rejection…"
                className="rounded-md border border-input bg-background px-2.5 py-1.5 text-[13.5px] outline-none placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
            </div>
          )}
          {/* O3 (AC-W3-O3): inline VI capture replaces the "Mark Vendor Invoiced" button
              when the user clicks it, co-locating invoice capture with the transition action. */}
          {showVICapture ? (
            <VIInlineCapture
              busy={mutations.transition.isPending || mutations.createInvoice.isPending}
              onSubmit={(viStatus, invoiceDate) => void submitVICapture(viStatus, invoiceDate)}
              onCancel={() => { setShowVICapture(false); setMutationError(null); }}
            />
          ) : actions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {actions.map((action) => {
                // D10 (AC-W3-D10): block Draft → Requested when there are no line items.
                // Only the Submit Request action (Draft→Requested) is gated; all other
                // actions on later stages are unaffected.
                const isSubmitBlocked =
                  action.to === 'Requested' && isDraft && p.items.length === 0;
                return (
                  <Button
                    key={action.to}
                    // The solid `destructive` fill belongs ONLY inside the confirm
                    // dialog (the system's single solid status fill) — at rest a
                    // destructive action (Reject / Cancel) is a quiet OUTLINE so it
                    // does not compete with the blue primary (the I4 two-solid-fills
                    // tell). onActionClick still reads action.variant for the
                    // dialog tone, so a kept destructive confirm stays red.
                    variant={action.variant === 'destructive' ? 'outline' : action.variant}
                    loading={mutations.transition.isPending}
                    disabled={isSubmitBlocked}
                    onClick={() => onActionClick(action)}
                  >
                    {action.label}
                  </Button>
                );
              })}
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              No further lifecycle actions are available to you at this stage.
            </p>
          )}
          {/* D10 (AC-W3-D10): gate message below the action bar when Draft with no items. */}
          {isDraft && p.items.length === 0 && actions.some((a) => a.to === 'Requested') && (
            <p className="text-[13px] text-muted-foreground" data-testid="line-items-gate">
              Add at least one line item before submitting.
            </p>
          )}
          {mutationError && (
            <div role="alert" className="flex items-start gap-2 text-[13px] text-destructive">
              <Icon name="alert" className="mt-px size-4 shrink-0" />
              <span>{mutationError}</span>
            </div>
          )}
        </CardPad>
      </Card>

      {/* GR creation panel (AC-816) */}
      {canShowGRForm && (
        <Card className="mb-4">
          <CardPad>
            {!showCreateGR ? (
              <Button variant="primary" size="sm" data-testid="btn-create-gr" onClick={() => setShowCreateGR(true)}>
                <Icon name="plus" />
                Create Goods Receipt
              </Button>
            ) : (
              <form
                data-testid="form-create-gr"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  setMutationError(null);
                  // Stage the GR for confirmation (commit fires on Confirm).
                  setPendingConfirm({
                    kind: 'createGR',
                    status: fd.get('gr-status') as 'Partial' | 'Complete',
                    receiptDate: fd.get('gr-date') as string,
                  });
                }}
                className="flex flex-wrap items-end gap-3"
              >
                <label className="flex flex-col gap-1 text-[12px] font-semibold text-muted-foreground">
                  Status
                  <select
                    name="gr-status"
                    defaultValue="Complete"
                    data-testid="gr-status-select"
                    className="h-8 w-40 rounded-md border border-input bg-background px-2 text-[13.5px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <option value="Partial">Partial</option>
                    <option value="Complete">Complete</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[12px] font-semibold text-muted-foreground">
                  Receipt date
                  <input
                    type="date"
                    name="gr-date"
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    data-testid="gr-date-input"
                    className="h-8 rounded-md border border-input bg-background px-2 text-[13.5px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  />
                </label>
                <Button type="submit" variant="success" size="sm" loading={mutations.createReceipt.isPending} data-testid="btn-save-gr">
                  Save GR
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowCreateGR(false)}>
                  Cancel
                </Button>
              </form>
            )}
          </CardPad>
        </Card>
      )}

      {/* VI creation panel (AC-816) */}
      {canShowVIForm && (
        <Card className="mb-4">
          <CardPad>
            {!showCreateVI ? (
              <Button variant="primary" size="sm" data-testid="btn-create-vi" onClick={() => setShowCreateVI(true)}>
                <Icon name="plus" />
                Create Vendor Invoice
              </Button>
            ) : (
              <form
                data-testid="form-create-vi"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  setMutationError(null);
                  // Stage the VI for confirmation (commit fires on Confirm).
                  // N1: status cast excludes Paid — the select no longer offers it.
                  setPendingConfirm({
                    kind: 'createVI',
                    status: fd.get('vi-status') as 'Received' | 'Scheduled',
                    invoiceDate: fd.get('vi-date') as string,
                  });
                }}
                className="flex flex-wrap items-end gap-3"
              >
                <label className="flex flex-col gap-1 text-[12px] font-semibold text-muted-foreground">
                  Status
                  <select
                    name="vi-status"
                    defaultValue="Received"
                    data-testid="vi-status-select"
                    className="h-8 w-40 rounded-md border border-input bg-background px-2 text-[13.5px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <option value="Received">Received</option>
                    <option value="Scheduled">Scheduled</option>
                    {/* N1 (AC-W3-N1): Paid removed — Mark as Paid is the sole PR→Paid authority. */}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[12px] font-semibold text-muted-foreground">
                  Invoice date
                  <input
                    type="date"
                    name="vi-date"
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    data-testid="vi-date-input"
                    className="h-8 rounded-md border border-input bg-background px-2 text-[13.5px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  />
                </label>
                <Button type="submit" variant="success" size="sm" loading={mutations.createInvoice.isPending} data-testid="btn-save-vi">
                  Save VI
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowCreateVI(false)}>
                  Cancel
                </Button>
              </form>
            )}
          </CardPad>
        </Card>
      )}

      {/* Editable line items (requester + PM/Finance/Admin while Draft) */}
      <LineItemsSection
        items={p.items}
        editable={canEditItems}
        busy={crud.createItem.isPending || crud.updateItem.isPending || crud.deleteItem.isPending}
        onError={onMutationError}
        onAdd={async (input) => {
          await crud.createItem.mutateAsync(input);
          toast('Line item added', input.name, 'success');
        }}
        onUpdate={async (id, patch) => {
          await crud.updateItem.mutateAsync({ id, patch });
          toast('Line item updated', patch.name, 'success');
        }}
        onDelete={async (id) => {
          await crud.deleteItem.mutateAsync(id);
          toast('Line item removed', undefined, 'success');
        }}
      />

      {/* Quotations (add + select-quote) + document trail */}
      <div className="grid gap-4 lg:grid-cols-2">
        <QuotationsSection
          quotations={p.quotations}
          selectedId={selectedQuote?.id ?? null}
          canAdd={canAddQuote}
          canSelect={canSelectQuote}
          addBusy={mutations.createQuotation.isPending}
          selectBusy={crud.selectQuote.isPending}
          onError={onMutationError}
          onAdd={async (input) => {
            await mutations.createQuotation.mutateAsync(input);
            toast('Quotation added', undefined, 'success');
          }}
          onSelect={async (quotationId) => {
            await crud.selectQuote.mutateAsync(quotationId);
            toast('Quote selected', 'The request advanced to Quote Selected', 'success');
          }}
        />

        <Card>
          <CardHead>Document trail</CardHead>
          <CardPad className="flex flex-col gap-2">
            <DocRow label="PR#" value={p.pr_number} />
            {selectedQuote && <DocRow label="VQ#" value={selectedQuote.vq_number} />}
            <DocRow label="PO#" value={p.po_number} />
            {p.receipts.map((r) => (
              <DocRow key={r.id} label="GR#" value={r.gr_number} sub={r.status} />
            ))}
            {p.invoices.map((inv) => (
              <DocRow key={inv.id} label="VI#" value={inv.vi_number} sub={inv.status} />
            ))}
          </CardPad>
        </Card>
      </div>

      {/* Documents metadata register (over the previously-dead procurement_documents) */}
      <ProcurementDocumentsSection
        documents={docsQuery.data ?? []}
        loading={docsQuery.isPending}
        error={docsQuery.isError}
        onRetry={() => docsQuery.refetch()}
        editable={canManageDocs}
        addBusy={crud.createDocument.isPending}
        deleteBusy={crud.deleteDocument.isPending}
        onError={onMutationError}
        onAdd={async (input) => {
          await crud.createDocument.mutateAsync(input);
          toast('Document added', input.type, 'success');
        }}
        onDelete={async (id) => {
          await crud.deleteDocument.mutateAsync(id);
          toast('Document removed', undefined, 'success');
        }}
      />

      {/* Approval / rejection notes */}
      {p.approval_notes && (
        <Card className="mt-4">
          <CardHead>Approval notes</CardHead>
          <CardPad>
            <p className="text-[13.5px]">{p.approval_notes}</p>
          </CardPad>
        </Card>
      )}
      {p.rejection_notes && (
        <Card className="mt-4">
          <CardHead>Rejection notes</CardHead>
          <CardPad>
            <p className="text-[13.5px] text-destructive">{p.rejection_notes}</p>
          </CardPad>
        </Card>
      )}

      {/* P1-P4 — confirm-before-write. One dialog drives every staged mutation;
          forward steps + GR/VI are default-tone, Reject/Cancel are destructive. */}
      <ConfirmDialog
        open={pendingConfirm !== null}
        tone={pendingConfirm?.kind === 'transition' ? pendingConfirm.tone : 'default'}
        title={
          pendingConfirm?.kind === 'transition'
            ? pendingConfirm.title
            : pendingConfirm?.kind === 'createGR'
              ? 'Record this goods receipt?'
              : 'Record this vendor invoice?'
        }
        description={
          pendingConfirm?.kind === 'transition'
            ? pendingConfirm.description
            : pendingConfirm?.kind === 'createGR'
              ? `This records a ${pendingConfirm.status.toLowerCase()} goods receipt against ${p.title}.`
              : `This records a vendor invoice against ${p.title}.`
        }
        confirmLabel={
          pendingConfirm?.kind === 'transition'
            ? pendingConfirm.confirmLabel
            : pendingConfirm?.kind === 'createGR'
              ? 'Save GR'
              : 'Save VI'
        }
        cancelLabel={
          pendingConfirm?.kind === 'transition' ? pendingConfirm.cancelLabel : undefined
        }
        loading={confirmInFlight}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => void commitConfirm()}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// O3 (AC-W3-O3): inline VI capture — appears in the action bar when the user
// clicks "Mark Vendor Invoiced", co-locating invoice capture with the transition.
// N1 (AC-W3-N1): Paid is excluded from status options here too.
// ---------------------------------------------------------------------------
interface VIInlineCaptureProps {
  busy: boolean;
  onSubmit: (status: 'Received' | 'Scheduled', invoiceDate: string) => void;
  onCancel: () => void;
}

const VIInlineCapture: React.FC<VIInlineCaptureProps> = ({ busy, onSubmit, onCancel }) => {
  const [viStatus, setViStatus] = React.useState<'Received' | 'Scheduled'>('Received');
  const [invoiceDate, setInvoiceDate] = React.useState(new Date().toISOString().slice(0, 10));

  return (
    <div data-testid="vi-inline-capture" className="flex flex-col gap-3">
      <p className="text-[12px] font-semibold text-muted-foreground">
        Enter invoice details to mark as Vendor Invoiced:
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-muted-foreground">
          Invoice status
          <select
            value={viStatus}
            onChange={(e) => setViStatus(e.target.value as 'Received' | 'Scheduled')}
            data-testid="vi-status-select"
            className="h-8 w-40 rounded-md border border-input bg-background px-2 text-[13.5px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <option value="Received">Received</option>
            <option value="Scheduled">Scheduled</option>
            {/* N1 (AC-W3-N1): Paid excluded — Mark as Paid is the sole PR→Paid authority. */}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-muted-foreground">
          Invoice date
          <input
            type="date"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
            data-testid="vi-date-input"
            className="h-8 rounded-md border border-input bg-background px-2 text-[13.5px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        </label>
        <Button
          variant="success"
          size="sm"
          loading={busy}
          disabled={!invoiceDate}
          data-testid="btn-submit-vi-capture"
          onClick={() => onSubmit(viStatus, invoiceDate)}
        >
          Confirm &amp; Mark Invoiced
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="btn-cancel-vi-capture"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
};

/** Mono doc-reference row (PR/VQ/PO/GR/VI) with an optional status sub-label. */
const DocRow: React.FC<{ label: string; value: string | null | undefined; sub?: string }> = ({
  label,
  value,
  sub,
}) => {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2.5 text-[13px]">
      <span className="w-9 shrink-0 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {label}
      </span>
      <span className="font-mono font-semibold">{value}</span>
      {sub && <StatusPill variant="neutral" className="ml-auto">{sub}</StatusPill>}
    </div>
  );
};

export default ProcurementDetails;
