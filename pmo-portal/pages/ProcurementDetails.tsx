import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  RecordHeader,
  Card,
  CardHead,
  CardPad,
  Button,
  StatusPill,
  LifecycleStepper,
  ListState,
  Icon,
  ConfirmDialog,
  Tabs,
  tabId,
  tabPanelId,
  useToast,
  ProjectNameLink,
  CompanyNameLink,
  type StatTile,
  type TabItem,
} from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { ProcurementOverviewTab, type DetailRow } from './procurement/ProcurementOverviewTab';
import { useProcurementDetail, useProcurementMutations } from '@/src/hooks/useProcurementDetail';
import { useProcurementCrudMutations } from '@/src/hooks/useProcurementCrud';
import { useVendorOptions } from '@/src/hooks/useFkOptions';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { can } from '@/src/auth/policy';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { formatCurrency } from '@/src/lib/format';
import { LineItemsSection } from './procurement/LineItemsSection';
import { VendorQuotesTab } from './procurement/VendorQuotesTab';
import { ProcurementHeaderEdit } from './procurement/ProcurementHeaderEdit';
import { ProcurementLedger } from './procurement/ProcurementLedger';
import { ProcurementDecisionZone } from './procurement/ProcurementDecisionZone';
import { buildLedgerRows } from '@/src/lib/db/procurementLedger';
import { buildProgressionTimeline } from '@/src/lib/db/procurementHistory';
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

// ---------------------------------------------------------------------------
// Tabbed record shell (mirrors ProjectDetail's `/projects/:id/:tab`). Default tab =
// Overview (status-at-a-glance: stepper above + the Overview bento). An absent/unknown
// :tab defaults to Overview and is role-invariant (CW-7); an explicit :tab always wins.
// ---------------------------------------------------------------------------
type ProcTab = 'overview' | 'items' | 'documents' | 'quotes';
const PROC_TAB_VALUES: ProcTab[] = ['overview', 'items', 'documents', 'quotes'];
function tabFromParam(param: string | undefined): ProcTab {
  if (param && (PROC_TAB_VALUES as string[]).includes(param)) return param as ProcTab;
  return 'overview';
}

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
      referenceNumber: string | null;
    }
  | {
      kind: 'createVI';
      /** N1: Paid removed — Mark as Paid is the sole PR→Paid authority (AC-W3-N1). */
      status: 'Received' | 'Scheduled';
      invoiceDate: string;
      referenceNumber: string | null;
      amount: number | null;
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
  // D7 (AC-IXD-PROC-W5-1b): at Approved, "Request Vendor Quotes" is the canonical
  // primary (OD-W5-2 — quoting first is the conventional lower-risk path). "Generate
  // Purchase Order" is a valid skip-to-PO path but is demoted to `outline` so only
  // ONE blue appears per stage (DESIGN.md One-Blue Rule). BOTH remain clickable.
  if (legal('Vendor Quoted') && canSource(role)) {
    actions.push({ to: 'Vendor Quoted', label: 'Request Vendor Quotes', variant: 'primary' });
  }
  if (legal('Ordered') && canSource(role) && status === 'Approved') {
    // outline (not primary) — see D7 note above
    actions.push({ to: 'Ordered', label: 'Generate Purchase Order', variant: 'outline' });
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

/**
 * D8 (AC-IXD-PROC-W5-1d): Sort actions so the visual/tab order is always:
 *   primary → outline → destructive (Cancel/Reject last, never above the primary)
 * This is a deliberate, fixed order — not relying on push-order + flex-wrap.
 * Weight: primary=0, outline/success=1, destructive=2.
 */
function sortActions(
  actions: { to: ProcurementStatus; label: string; variant: ActionVariant }[],
): { to: ProcurementStatus; label: string; variant: ActionVariant }[] {
  const weight = (v: ActionVariant): number => {
    if (v === 'primary') return 0;
    if (v === 'destructive') return 2;
    return 1; // outline, success
  };
  return [...actions].sort((a, b) => weight(a.variant) - weight(b.variant));
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
  const { procurementId, tab: tabParam } = useParams<{ procurementId: string; tab?: string }>();
  // Active tab from the URL :tab param (deep-linkable, role-invariant default Overview).
  const tab = tabFromParam(tabParam);
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

  // Vendor name map for VendorQuotesTab — reuses the cached FK option list so
  // there is no extra fetch; org_id scoping is handled by RLS inside the repo.
  const { data: vendorOptions } = useVendorOptions();
  const vendorMap: Record<string, string> = React.useMemo(
    () => Object.fromEntries((vendorOptions ?? []).map((o) => [o.value, o.label])),
    [vendorOptions],
  );

  const [mutationError, setMutationError] = useState<string | null>(null);
  const [notesInput, setNotesInput] = useState('');
  const [showCreateGR, setShowCreateGR] = useState(false);
  const [showCreateVI, setShowCreateVI] = useState(false);
  // CW-3a: the header Edit affordance (RecordHeader action zone) toggles the inline
  // header-edit panel. Procurement's role-allowed header action set is Edit only —
  // there is no archive/delete (Cancel is a lifecycle transition, in the action zone).
  const [headerEditOpen, setHeaderEditOpen] = useState(false);
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

  // Deep-linkable tab switch (mirrors ProjectDetail) — replace so tab changes don't
  // pile up in history. The shell route is `/procurement/:procurementId/:tab?`.
  const setTab = (next: ProcTab) =>
    navigate(`/procurement/${procurementId}/${next}`, { replace: true });

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
  // D8: sort so primary → outline/success → destructive (Cancel/Reject always last)
  const actions = sortActions(allowedActions(p.status, role, isRequester, isApprover));
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
  // Header edit: requester may edit while Draft/Rejected (record-scoped entity edit).
  // A8: Admin break-glass header edit while Draft/Rejected (RLS 0010 permits; edit is not an SoD axis).
  // CW-EDIT-1: the Edit affordance is surfaced inside the RecordHeader action zone (not buried
  // elsewhere), but its visibility remains record-scoped — Edit only appears on Draft/Rejected
  // procurements and only to the requester or an Admin. No archive/delete — Cancel is a lifecycle
  // transition in the action zone. RLS remains the enforcement authority.
  const canEditHeader =
    (isDraft || isRejected) && (isRequester || realRole === 'Admin') && may('edit', 'procurement');
  // Line items: requester OR PM/Finance/Admin while Draft (matches the 0015 RLS).
  const canEditItems = isDraft && (isRequester || may('edit', 'procItem'));
  // Quotations: sourcing roles add; select offered only while Vendor Quoted.
  const canAddQuote = may('create', 'quotation');
  const canSelectQuote = may('create', 'quotation') && p.status === 'Vendor Quoted';
  // Phase-file attachments (ADR-0023): same writer set as procDoc; RLS is the authority.
  const canManageFiles = may('create', 'procFile');
  const currentUserId = currentUser?.id ?? null;

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
      {p.project?.name ? <> on <ProjectNameLink projectId={p.project_id} name={p.project.name} /></> : null}
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
          referenceNumber: pendingConfirm.referenceNumber,
        });
        setShowCreateGR(false);
        toast('Goods receipt recorded', undefined, 'success');
      } else {
        await mutations.createInvoice.mutateAsync({
          status: pendingConfirm.status,
          invoiceDate: pendingConfirm.invoiceDate,
          referenceNumber: pendingConfirm.referenceNumber,
          amount: pendingConfirm.amount,
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
  const submitVICapture = async (
    viStatus: 'Received' | 'Scheduled',
    invoiceDate: string,
    referenceNumber: string | null,
    amount: number | null,
  ) => {
    setMutationError(null);
    try {
      await mutations.transition.mutateAsync({ to: 'Vendor Invoiced', notes: notesInput || undefined });
      await mutations.createInvoice.mutateAsync({ status: viStatus, invoiceDate, referenceNumber, amount });
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

  // ── Stat tiles (sparse + honest — I2/I3 design-review fixes) ───────────────
  // I3: only render a tile when its value is real (not a placeholder like
  //     "Pending / None yet / no PO yet / awaiting delivery"). Early/Draft cases
  //     had 4 placeholder tiles that re-introduced the empty-state noise the
  //     revamp removed. Build the tile array conditionally then pass the live set.
  // I2: on terminal states (Paid / Cancelled) never show "awaiting delivery" —
  //     derive the sub-text from actual record state; omit the tile if no receipt
  //     exists rather than asserting a falsehood.
  const statTilesRaw: (StatTile | null)[] = [
    // PR value — always shown (every procurement has a total_value)
    {
      label: 'PR value',
      value: formatCurrency(Number(p.total_value)),
      sub: p.project?.name ?? undefined,
    },
    // Selected quote — only when a quote is committed (Quote Selected onward).
    // AC-IXD-PROC-004: the chosen quotation tile is bound through to Paid.
    // PRD-1 (AC-JR-W3B-E1): vendor name is a CompanyNameLink.
    selectedQuote
      ? {
          label: 'Selected quote',
          value: formatCurrency(Number(selectedQuote.total_amount)),
          sub: (
            <CompanyNameLink
              companyId={p.vendor_id}
              name={p.vendor?.name ?? selectedQuote.vq_number ?? 'selected'}
              className="text-[11px]"
            />
          ),
        }
      : null,
    // PO committed — only when a purchase_order record exists.
    // I1 companion: we derive existence from the record table, not the denormalized
    // p.po_number header column (which may be set before a PO record is captured).
    p.purchase_orders && p.purchase_orders.length > 0
      ? {
          label: 'PO committed',
          // Use the PO record's amount if available, else fall back to total_value.
          value: formatCurrency(
            Number((p.purchase_orders[0] as { amount?: number | null }).amount ?? p.total_value),
          ),
          sub: p.vendor?.name ? (
            // PRD-1 (AC-JR-W3B-E1)
            <CompanyNameLink
              companyId={p.vendor_id}
              name={p.vendor.name}
              className="text-[11px]"
            />
          ) : undefined,
        }
      : null,
    // Goods received — only when at least one receipt exists.
    // I2: on terminal states, derive sub from actual receipt status (not "awaiting
    // delivery"). If no receipt exists on a terminal case, omit the tile entirely.
    p.receipts.length > 0
      ? {
          label: 'Goods received',
          value: `${p.receipts.length} receipt${p.receipts.length > 1 ? 's' : ''}`,
          // Derive from actual receipt status — never assert "awaiting delivery"
          // on a terminal case (Paid/Cancelled) where goods are already settled.
          sub: p.receipts[p.receipts.length - 1].status,
        }
      : null,
  ];
  const stats = statTilesRaw.filter((t): t is StatTile => t !== null);

  const meta = [
    p.code ? <span key="code" className="font-mono">{p.code}</span> : null,
    p.project?.name ? <span key="proj"> · <ProjectNameLink projectId={p.project_id} name={p.project.name} /></span> : null,
    p.requested_by?.full_name ? <span key="req"> · requested by {p.requested_by.full_name}</span> : null,
  ].filter(Boolean);

  // Overview Detail <dl> rows (the Field grammar). Vendor / Approved-by read a muted
  // "Not yet selected" / "Pending" while absent rather than a bare blank (G5 honesty).
  const detailRows: DetailRow[] = [
    {
      label: 'Project',
      value: p.project?.name ? (
        <ProjectNameLink projectId={p.project_id} name={p.project.name} />
      ) : (
        <span className="text-muted-foreground">Not linked</span>
      ),
    },
    {
      label: 'Vendor',
      value: p.vendor?.name ? (
        <CompanyNameLink companyId={p.vendor_id} name={p.vendor.name} />
      ) : (
        <span className="text-muted-foreground">Not yet selected</span>
      ),
    },
    {
      label: 'Requested by',
      value: p.requested_by?.full_name ?? (
        <span className="text-muted-foreground">—</span>
      ),
    },
    {
      label: 'Approved by',
      value: p.approved_by?.full_name ?? (
        <span className="text-muted-foreground">Pending</span>
      ),
    },
  ];

  // Progression-history events — transition-centric merge (buildProgressionTimeline):
  // transitions are the spine; each matching record is folded in as a docRef annotation
  // rather than a separate row. Results in ~one row per lifecycle event (no duplication).
  const historyEvents = buildProgressionTimeline(p, p.id);

  // Tab bar (counts on the three non-Overview tabs). Documents count = the ledger
  // row count (all 7 record types, one row each, as built by buildLedgerRows).
  const ledgerRows = buildLedgerRows(p);
  const documentsCount = ledgerRows.length;
  const procTabs: TabItem<ProcTab>[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'items', label: 'Line items', count: p.items.length || null },
    { value: 'documents', label: 'Documents', count: documentsCount || null },
    { value: 'quotes', label: 'Vendor quotes', count: p.quotations.length || null },
  ];

  return (
    <div>
      {/* C-IMP-1 (AC-S6-3): BackBar on mobile success render ≤920px.
          The top-bar breadcrumb owns desktop wayfinding (I7); on mobile the rail
          is collapsed and the breadcrumb is not visible, so the BackBar is the
          only in-content escape. CSS-only visibility: `hidden` on desktop,
          `max-[920px]:block` on mobile — single DOM, no dual a11y tree. */}
      <div data-testid="mobile-back-bar" className="hidden max-[920px]:block">
        <BackBar label="Procurement" onBack={goBack} />
      </div>

      {/* CW-3a: the ONE RecordHeader anatomy — icon + name + status pill + top-right
          action zone (DESIGN.md §7). Procurement's role-allowed header action is Edit
          (requester/Admin while Draft/Rejected); it has no archive/delete (Cancel is a
          lifecycle transition, surfaced in the decision/action zone below). */}
      <RecordHeader
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
        actions={
          canEditHeader ? (
            <Button
              variant="outline"
              size="sm"
              data-testid="edit-header"
              onClick={() => setHeaderEditOpen((open) => !open)}
              aria-expanded={headerEditOpen}
            >
              Edit
            </Button>
          ) : undefined
        }
      />

      {/* Full lifecycle bar stepper (PR → VQ → PO → GR → VI → Paid) — the ONE stepper
          (DESIGN.md §5; the numbered-circle node variant was retired in the Coherence Wave). */}
      <Card className="mb-4">
        <CardPad>
          <LifecycleStepper
            variant="bar"
            steps={lifecycleSteps(p.status, {
              // I1 (design-review): refs must come from ACTUAL record rows, not the
              // denormalized header columns (p.pr_number / p.po_number). The header
              // columns may be set even when no record exists in the ledger, causing
              // the stepper to show a doc number that has no corresponding record in
              // the Documents tab — a dishonest doorway. Derive each ref from the
              // actual record arrays so the stepper can only show a ref when a record
              // genuinely exists. GR and VI already used the record arrays.
              pr_number: p.purchase_requests?.[0]?.pr_number ?? null,
              vq_number: selectedQuote?.vq_number,
              po_number: p.purchase_orders?.[0]?.po_number ?? null,
              gr_number: p.receipts[0]?.gr_number,
              vi_number: p.invoices[0]?.vi_number,
            })}
            aria-label="Procurement lifecycle"
          />
        </CardPad>
      </Card>

      {/* Draft-header edit (requester while Draft/Rejected) — opened from the header Edit action */}
      {canEditHeader && headerEditOpen && (
        <ProcurementHeaderEdit
          title={p.title}
          projectId={p.project_id}
          projectName={p.project?.name ?? null}
          vendorId={p.vendor_id}
          vendorName={p.vendor?.name ?? null}
          busy={crud.updateHeader.isPending}
          onError={onMutationError}
          onClose={() => setHeaderEditOpen(false)}
          onSave={async (patch) => {
            await crud.updateHeader.mutateAsync(patch);
            toast('Request updated', 'Header saved', 'success');
          }}
        />
      )}

      {/* ░░ DECISION STRIP — relocated (IxD Change 1) ░░
          Owner IxD: the decision zone is a COMPACT, NON-STICKY action strip placed
          directly below the lifecycle stepper and ABOVE the tabs. Previously it was a
          sticky-bottom bar floating over the page; now it sits in normal flow so the
          stage-appropriate action(s) read as the first thing after the stepper, with
          minimal vertical whitespace. SoD hint is a single muted inline line; Notes is
          progressive-disclosure (revealed only after Approve/Reject is clicked). The
          GR/VI inline capture stays grouped here (transition-coupled). The decision
          zone still renders inside RecordActionZone (enforcement contract) — only its
          placement + sticky behaviour change; the SoD/transition machine is untouched. */}
      <ProcurementDecisionZone
        p={p}
        actions={actions}
        gateMsg={gateMsg}
        isDraft={isDraft}
        isRequester={isRequester}
        isApprover={isApprover}
        showNotes={showNotes}
        notesInput={notesInput}
        setNotesInput={setNotesInput}
        showVICapture={showVICapture}
        setShowVICapture={setShowVICapture}
        submitVICapture={submitVICapture}
        canShowGRForm={canShowGRForm}
        canShowVIForm={canShowVIForm}
        showCreateGR={showCreateGR}
        setShowCreateGR={setShowCreateGR}
        showCreateVI={showCreateVI}
        setShowCreateVI={setShowCreateVI}
        setPendingConfirm={setPendingConfirm}
        setMutationError={setMutationError}
        mutationError={mutationError}
        onActionClick={onActionClick}
        mutations={mutations}
      />

      {/* ░░ TABBED RECORD SHELL — mirrors /projects/:id/:tab ░░
          Default tab = Overview (the bento: stat-at-a-glance + budget + detail +
          progression). The other tabs home the Line items / Documents / Vendor quotes. */}
      <Tabs<ProcTab>
        items={procTabs}
        value={tab}
        onChange={setTab}
        ariaLabel="Procurement sections"
        idBase="procurement-detail"
      />

      <div
        role="tabpanel"
        id={tabPanelId('procurement-detail', tab)}
        aria-labelledby={tabId('procurement-detail', tab)}
        data-testid={`procurement-tabpanel-${tab}`}
      >
        {tab === 'overview' && (
          <ProcurementOverviewTab
            tiles={stats}
            detailRows={detailRows}
            events={historyEvents}
            projectId={p.project_id}
            projectName={p.project?.name ?? null}
            totalValue={Number(p.total_value)}
            status={p.status}
          />
        )}

        {tab === 'items' && (
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
        )}

        {/* ░░ Documents tab — Slice 2: ProcurementLedger (the single case ledger).
            All 7 record types, chronological, one row each. Filter chips: All /
            Financial / Has file. Capture affordance at bottom (LedgerCaptureRow).
            ProcurementRecordsSection / DocRow / ProcurementDocumentsSection removed. ░░ */}
        {tab === 'documents' && (
          <Card variant="bare">
            <ProcurementLedger
              detail={p}
              rows={ledgerRows}
              procurementId={p.id}
              uploadedById={currentUserId}
              canWrite={canManageFiles}
              invoices={p.invoices}
            />
          </Card>
        )}

        {/* ░░ Vendor quotes tab — Slice 3: VendorQuotesTab (bid comparison).
            Refactors QuotationsSection into a side-by-side comparison layout:
            Vendor / Amount / Valid until · selected row highlighted + won pill.
            Reuses the existing selectQuote RPC + SoD/role gating unchanged. ░░ */}
        {tab === 'quotes' && (
          <VendorQuotesTab
            quotations={p.quotations}
            selectedId={selectedQuote?.id ?? null}
            canAdd={canAddQuote}
            canSelect={canSelectQuote}
            addBusy={mutations.createQuotation.isPending}
            selectBusy={crud.selectQuote.isPending}
            procurementId={p.id}
            canManageFiles={canManageFiles}
            currentUserId={currentUserId}
            vendorMap={vendorMap}
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
        )}
      </div>

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

      {/* B-C-2 + A-IMP-2 (AC-S6-1): sticky mobile primary action bar.
          On a long procurement record the decision card can be far below the fold.
          On mobile (≤920px) the stage-appropriate primary action is anchored at
          the viewport bottom so it is always reachable without scrolling.
          CSS-only: `hidden max-[920px]:flex` — single DOM, no dual a11y tree.
          Only rendered when at least one action is available; terminal/no-action
          states omit the bar entirely (nothing to anchor).
          The in-card action row remains the canonical slot; this bar mirrors the
          primary CTA only, providing the mobile reach affordance. */}
      {actions.length > 0 && !showVICapture && (
        <div
          data-testid="mobile-sticky-action"
          aria-hidden="true"
          className="hidden max-[920px]:flex fixed bottom-0 left-0 right-0 z-10 items-center gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-sm"
        >
          {actions
            .filter((a) => a.variant === 'primary')
            .slice(0, 1)
            .map((action) => {
              const isSubmitBlocked =
                action.to === 'Requested' && isDraft && p.items.length === 0;
              return (
                <Button
                  key={`sticky-${action.to}`}
                  variant="primary"
                  tabIndex={-1}
                  className="flex-1"
                  loading={mutations.transition.isPending}
                  disabled={isSubmitBlocked}
                  onClick={() => onActionClick(action)}
                >
                  {action.label}
                </Button>
              );
            })}
        </div>
      )}
    </div>
  );
};


export default ProcurementDetails;
