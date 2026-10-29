import { projectDisplayName } from '@/src/lib/projectDisplayName';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import {
  RecordHeader,
  Card,
  CardHead,
  CardPad,
  Button,
  Combobox,
  StatusPill,
  ListState,
  Icon,
  ConfirmDialog,
  Tabs,
  tabId,
  tabPanelId,
  useToast,
  useIsNarrow,
  ProjectNameLink,
  CompanyNameLink,
  type TabItem,
} from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import type { DetailRow } from './procurement/ProcurementOverviewTab';
import { useProcurementDetail, useProcurementMutations } from '@/src/hooks/useProcurementDetail';
import { useProcurementCrudMutations } from '@/src/hooks/useProcurementCrud';
import { useProcurementRecordMutations } from '@/src/hooks/useProcurementRecords';
import { useErpOrphans } from '@/src/hooks/useErpPurchases';
import { useErpItemOptions } from '@/src/hooks/useErpItemOptions';
import { useProject } from '@/src/hooks/useProjects';
import { useVendorOptions } from '@/src/hooks/useFkOptions';
import { useVendorWithholdingRegister, useVendorWithholdingSlipMutations } from '@/src/hooks/useVendorWithholdingSlips';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import { mayDecideRoutedApproval, approvalRouteNote } from '@/src/lib/procurement/approvalRoute';
import { withTabSwitchNavState } from '@/src/lib/tabSwitchNav';
import { useAuth } from '@/src/auth/useAuth';
import { formatCurrency } from '@/src/lib/format';
import { LineItemsSection } from './procurement/LineItemsSection';
import { VendorQuotesTab } from './procurement/VendorQuotesTab';
import { PaymentCeilingNotice } from './procurement/PaymentCeilingNotice';
import { ProcurementHeaderEdit } from './procurement/ProcurementHeaderEdit';
import { ProcurementLedger } from './procurement/ProcurementLedger';
import { erpDoctypeLabel } from './procurement/erpLinkReasons';
import { useProcurementGates } from '@/src/hooks/useProcurementGates';
import { itemsNetTotal } from '@/src/lib/itemsNet';
import { purchaseHasValue } from './procurement/purchaseValue';
import { recordableFirstKinds } from './procurement/firstDocument';
import { useLinkedErpDocuments } from '@/src/hooks/useErpPurchaseLinks';
import { LinkedErpDocuments } from './procurement/LinkedErpDocuments';
import { ProcurementMicrosoftReferences } from './procurement/ProcurementMicrosoftReferences';
import { VendorWithholdingSlipModal } from './procurement/VendorWithholdingSlipModal';
import { VendorWithholdingSlipDetails } from './procurement/VendorWithholdingSlipDetails';
import {
  ProcurementDecisionZone,
  type VendorInvoiceCapture,
} from './procurement/ProcurementDecisionZone';
import { buildLedgerRows, type LedgerRow } from '@/src/lib/db/procurementLedger';
import {
  type ProcurementStatus,
  type ProcurementDetail,
  type TaxTreatment,
} from '@/src/lib/db/procurementLifecycle';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { CommandIntent } from '@/src/lib/repositories/types';
import type { ErpVendorTaxAmounts, PphType } from '@/src/lib/vendorWithholding';
import { useAgentContext } from '@/src/lib/agent/context/useAgentContext';
import { useListReturn } from '@/src/hooks/useListReturn';
import { RecordHistory } from '@/src/components/history/RecordHistory';
import { RecordCaptureForm, type CreateRecordInput, type RecordKind } from './procurement/RecordCaptureForm';
import { LinkErpDocumentsDialog } from './procurement/LinkErpDocumentsDialog';
import { DecisionSupportPanel } from './procurement/DecisionSupportPanel';
import { ProcurementBudgetSignal, ProcurementStageTracker, ProcurementMoneySummary, ProcurementTimeline } from './procurement/detail/ProcurementDetailPanels';
import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';
import { pillVariantForStatus, stageLabelForStatus, selectedQuotation, toastStateLabel } from '../components/procurement';
import { stageForStatus } from './procurement/blocks/stage';
import {
  allowedActions,
  canApproveReject,
  canSource,
  INVOICE_PAY_ROLES,
  RECEIPT_ROLES,
  sortActions,
  stateMainAction,
  type ActionVariant,
} from './procurement/blocks/mainAction';
/** The ledger row type -> the `procurement_documents.record_kind` it attaches as (0361). */
const LEDGER_KIND = {
  PR: 'purchase_request', RFQ: 'rfq', Quote: 'quotation', PO: 'purchase_order', GR: 'goods_receipt', Invoice: 'vendor_invoice', Payment: 'payment',
} as const;

// ---------------------------------------------------------------------------
// Tabbed record shell (mirrors ProjectDetail's `/projects/:id/:tab`). Default tab =
// Overview (status-at-a-glance: stepper above + the Overview bento). An absent/unknown
// :tab defaults to Overview and is role-invariant (CW-7); an explicit :tab always wins.
// ---------------------------------------------------------------------------
type ProcTab = 'timeline' | 'items' | 'quotes' | 'files' | 'details';
const PROC_TAB_VALUES: ProcTab[] = ['timeline', 'items', 'quotes', 'files', 'details'];
/** Runs `run` once after mount (a hand-off that must see the fully derived page state). */
const RunOnMount: React.FC<{ run: () => void }> = ({ run }) => {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    run();
  }, [run]);
  return null;
};

function tabFromParam(param: string | undefined): ProcTab {
  if (param === 'documents') return 'files';
  if (param === 'overview' || param === 'history') return 'timeline';
  if (param && (PROC_TAB_VALUES as string[]).includes(param)) return param as ProcTab;
  return 'timeline';
}


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
      /** BLOCK 2 (ADR-0058): the capture form's command identity, carried verbatim to the commit. */
      intent: CommandIntent;
    }
  | {
      kind: 'createVI';
      /** N1: Paid removed — Mark as Paid is the sole PR→Paid authority (AC-W3-N1). */
      status: 'Received' | 'Scheduled';
      invoiceDate: string;
      referenceNumber: string | null;
      /** #769: the parent group's number for this invoice. */
      externalRef?: string | null;
      amount: number | null;
      /** #505: REQUIRED — staged from the capture form and carried verbatim through the confirm to
       *  the RPC, so the confirmed write can never be the one that discovers they are missing. */
      taxTreatment: TaxTreatment;
      taxAmount: number;
      taxRate?: number | null;
      taxBaseNumerator?: number;
      taxBaseDenominator?: number;
      /** #520: the ERPNext purchase tax template chosen on a flipped org. */
      taxTemplate?: string;
      /** #876 slice 2: standalone tax withheld + its PPh type (only when > 0, OQ-VWH-6) and the ERP-bound entered amounts. */
      withheldAmount?: number;
      withheldPphType?: PphType;
      erpTaxAmounts?: ErpVendorTaxAmounts;
      /** BLOCK 2 (ADR-0058): see the createGR variant. */
      intent: CommandIntent;
    };


/** Whether the effective role/identity may not yet advance — drives the SoD gate copy. */
function sodGateMessage(p: ProcurementDetail, role: string, isRequester: boolean): string | null {
  // Approval gate: a Requested PR awaiting a non-requester approver.
  if (p.status === 'Requested' && isRequester) {
    return `This procurement was raised by ${p.requested_by?.full_name ?? 'you'}. A different user holding the Project-Manager, Finance, or Executive role must review it — the requester cannot self-approve their own procurement.`;
  }
  // Receipt gate: an Ordered PR where the viewer cannot confirm receipt.
  if (p.status === 'Ordered' && !(isRequester || RECEIPT_ROLES.has(role))) {
    return 'To advance from Purchase Order to Goods Receipt, the requester or a Project-Manager must confirm receipt of the goods.';
  }
  return null;
}

const ProcurementDetails: React.FC = () => {
  const { t } = useTranslation();
  const { procurementId, tab: tabParam } = useParams<{ procurementId: string; tab?: string }>();
  // Active tab from the URL :tab param (deep-linkable, role-invariant default Overview).
  const tab = tabFromParam(tabParam);
  // ADR-0016: write affordances gate on the REAL JWT role (not the impersonated
  // effectiveRole) so the buttons shown match what the RPC will actually honor.
  const { realRole, effectiveRole } = useEffectiveRole();
  const may = usePermission();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const bupotParams = new URLSearchParams(location.search);
  const bupotId = bupotParams.get('bupot');
  const targetInvoiceId = bupotId ? bupotParams.get('bupotBill') : null;

  const detailQuery = useProcurementDetail(procurementId);
  const projectScopeQuery = useProject(realRole === 'Project Manager' ? detailQuery.data?.project_id ?? undefined : undefined);
  const linkedErpQuery = useLinkedErpDocuments(procurementId);
  const linkedDocs = linkedErpQuery.data ?? [];
  const gates = useProcurementGates().data;
  const mutations = useProcurementMutations(procurementId ?? '');
  const crud = useProcurementCrudMutations(procurementId ?? '');
  const recordMutations = useProcurementRecordMutations(procurementId ?? '');
  const erpItems = useErpItemOptions('purchase');
  const [recordSlipInvoice, setRecordSlipInvoice] = useState<ProcurementDetail['invoices'][number] | null>(null);
  const [slipHistoryInvoiceId, setSlipHistoryInvoiceId] = useState<string | null>(null);
  const historyReturnFocus = React.useRef<HTMLElement | null>(null);
  const setBupotSelection = (slipId: string | null) => {
    const params = new URLSearchParams(location.search);
    if (slipId) {
      params.set('bupot', slipId);
      params.delete('bupotBill');
    } else {
      params.delete('bupot');
      params.delete('bupotBill');
    }
    const query = params.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ''}${location.hash}`, { replace: !slipId });
  };

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
  const [captureKind, setCaptureKind] = useState<RecordKind | null>(null);
  const [autoOpenFirstDocument, setAutoOpenFirstDocument] = useState<RecordKind | null>(null);
  const [recordMenuOpen, setRecordMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const isNarrow = useIsNarrow();
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(tabParam === 'history');
  const quoteAutoOpen = useRef(false);
  // CW-3a: the header Edit affordance (RecordHeader action zone) toggles the inline
  // header-edit panel. Procurement's role-allowed header action set is Edit only —
  // there is no archive/delete (Cancel is a lifecycle transition, in the action zone).
  const [headerEditOpen, setHeaderEditOpen] = useState(false);
  const [vendorPickerOpen, setVendorPickerOpen] = useState(false);
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  // O3 (AC-W3-O3): "Mark Vendor Invoiced" inline capture — open when the user
  // clicks the action so invoice details are captured BEFORE the transition fires.
  const [showVICapture, setShowVICapture] = useState(false);
  // Confirm-before-write (owner rule): a transition action / GR / VI is staged
  // here and only commits when the ConfirmDialog's Confirm is pressed.
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const erpOrphanQuery = useErpOrphans(undefined, { enabled: linkDialogOpen });

  // FR-AXP-021 (Track C): publish the loaded record to the live agent context so a
  // follow-up like "summarize this" grounds to the viewed procurement case —
  // grounding only (NFR-AXP-SEC-003), never an authorization signal. Placed before
  // any early return (Rules of Hooks) — cleared on unmount/navigate.
  // Reads `detailQuery.data` directly (not a pre-aliased local) so the later reads of
  // `detailQuery.data` (after the loading/no-access/error guards below) keep their
  // discriminated-union narrowing — an early `const data = detailQuery.data` alias
  // would break CFA at the point of use further down (strict-mode TS2339/TS2322).
  const { setEntity } = useAgentContext();
  useLayoutEffect(() => {
    if (!detailQuery.data) return;
    if (realRole === 'Engineer' && detailQuery.data.requested_by_id !== currentUser?.id) return;
    if (realRole === 'Project Manager' && (projectScopeQuery.isPending || projectScopeQuery.isError || projectScopeQuery.data?.project_manager_id !== currentUser?.id)) return;
    setEntity({ type: 'procurement_case', id: detailQuery.data.id, label: detailQuery.data.title });
    return () => setEntity(undefined);
  }, [detailQuery.data, setEntity, realRole, currentUser?.id, projectScopeQuery.data, projectScopeQuery.isPending, projectScopeQuery.isError]);

  // Arrival capture links are emitted by the procurement creation flow. Consume the
  // query once, open the existing record capture, then keep unrelated query state.
  useEffect(() => {
    if (!detailQuery.data) return;
    const params = new URLSearchParams(location.search);
    const requested = params.get('record');
    if (!requested) return;
    let nextPath = location.pathname;
    if (requested === 'receipt') setShowCreateGR(true);
    else if (requested === 'invoice') setShowVICapture(true);
    else if (requested === 'po') {
      setAutoOpenFirstDocument('purchase_order');
      nextPath = `/procurement/${procurementId}/files`;
    }
    else if (requested === 'payment') setCaptureKind('payment');
    else if (requested === 'quotation') {
      quoteAutoOpen.current = true;
      nextPath = `/procurement/${procurementId}/quotes`;
    }
    params.delete('record');
    const query = params.toString();
    navigate(`${nextPath}${query ? `?${query}` : ''}${location.hash}`, {
      replace: true,
      ...(requested === 'quotation' ? { state: withTabSwitchNavState(location.state) } : {}),
    });
  }, [detailQuery.data, location.hash, location.pathname, location.search, location.state, navigate, procurementId]);

  // Back to the Procurement index (AC-NAV-007/AC-LRC-005): `returnToList` navigates to the
  // captured Procurement list URL when the record was opened from a narrowed list, and falls
  // back to the bare index with clean state for a direct/copied link. The desktop parent
  // breadcrumb reads the same context via App.tsx's `contextualListReturnNavigation`.
  const { returnToList } = useListReturn({ list: 'procurement' });
  const goBack = () => returnToList('procurement');

  // Deep-linkable tab switch (mirrors ProjectDetail) — replace so tab changes don't
  // pile up in history. The shell route is `/procurement/:procurementId/:tab?`.
  // list-working-set-return (#682): forward the current router state so a captured
  // `pmoListReturn` context (and any one-shot scroll restore) survives a tab switch.
  // #879: mark the navigation as an in-page tab switch so AppShell's route-focus
  // effect keeps focus in the tab bar (WCAG 2.4.3); Tabs moves focus to the new tab.
  const setTab = (next: ProcTab) =>
    navigate(`/procurement/${procurementId}/${next}`, {
      replace: true,
      state: withTabSwitchNavState(location.state),
    });
  useEffect(() => {
    if (!tabParam || !['overview', 'documents', 'history'].includes(tabParam)) return;
    if (tabParam === 'history') setHistoryOpen(true);
    navigate(`/procurement/${procurementId}/${tabParam === 'documents' ? 'files' : 'timeline'}${location.search}`, {
      replace: true,
      state: withTabSwitchNavState(location.state),
    });
  }, [tabParam, procurementId, location.search, location.state, navigate]);
  useEffect(() => {
    if (!quoteAutoOpen.current || tabParam !== 'quotes') return;
    document.querySelector<HTMLButtonElement>('[data-testid="add-quotation"]')?.click();
    quoteAutoOpen.current = false;
  }, [tabParam]);

  // ── Loading (AC-804, NFR-PROC-UI-001) ────────────────────────────────────
  if (detailQuery.isPending) {
    return (
      <>
        <BackBar label={t('procurementDetail.backToProcurement', 'Procurement')} phoneOnly onBack={goBack} />
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
  // NOTE: no `!detailQuery.isPending` conjunct here — the loading guard above already
  // returned on that variant, so `isPending` is always false at this point; keeping it
  // in the chain narrows `detailQuery` to `never` under strict mode (every remaining
  // non-error `QueryObserverResult` variant types `data` as non-optional `TData`, so
  // `!detailQuery.data` is provably unreachable once `isPending` is also excluded —
  // the "no isPending" phrasing avoids that dead conjunct, not a behavior change).
  if (isNoAccess || (!detailQuery.isError && !detailQuery.data)) {
    return (
      <>
        <BackBar label={t('procurementDetail.backToProcurement', 'Procurement')} phoneOnly onBack={goBack} />
        {/* BackBar above already carries the "Back to Procurement" escape route,
            so the empty state does not repeat it (avoids a duplicate control). */}
        <div data-testid="procurement-no-access">
          <ListState
            variant="empty"
            icon="lock"
            titleAsPageHeading
            title={t('procurementDetail.accessDenied.title', "You don't have access to this record")}
            sub={t(
              'procurementDetail.accessDenied.sub',
              "This procurement record either doesn't exist or isn't visible to your role. If you created it, open it from your procurement list.",
            )}
          />
        </div>
      </>
    );
  }

  // ── Error (AC-804) — a genuine transient failure (offer Retry) ───────────
  if (detailQuery.isError) {
    return (
      <>
        <BackBar label={t('procurementDetail.backToProcurement', 'Procurement')} phoneOnly onBack={goBack} />
        <ListState
          variant="error"
          title={t('procurementDetail.error.title', "Couldn't load procurement")}
          sub={t('procurementDetail.error.sub', 'Something went wrong fetching the procurement details.')}
          onRetry={() => detailQuery.refetch()}
        />
      </>
    );
  }

  const p: ProcurementDetail = detailQuery.data;
  const role = realRole ?? '';
  const managerId = projectScopeQuery.data?.project_manager_id;
  // The requester always sees their own procurement, whatever project (or none) it sits on.
  const raisedByMe = !!currentUser?.id && p.requested_by_id === currentUser.id;
  if (role === 'Project Manager' && !raisedByMe && p.project_id && projectScopeQuery.isPending) {
    return <>
      <div data-testid="mobile-back-bar" className="hidden max-[920px]:block"><BackBar label={t('procurementDetail.backToProcurement', 'Procurement')} onBack={goBack} /></div>
      <div data-testid="procurement-loading"><ListState variant="loading" rows={6} /></div>
    </>;
  }
  const recordInScope = role === 'Engineer'
    ? raisedByMe
    : role === 'Project Manager'
      ? raisedByMe || Boolean(p.project_id && !projectScopeQuery.isError && projectScopeQuery.data != null && managerId === currentUser?.id)
      : true;
  if (!recordInScope) {
    return <>
      <div data-testid="mobile-back-bar" className="hidden max-[920px]:block"><BackBar label={t('procurementDetail.backToProcurement', 'Procurement')} onBack={goBack} /></div>
      <div data-testid="procurement-no-access"><ListState variant="empty" icon="lock" titleAsPageHeading title={t('procurementDetail.accessDenied.title', "You don't have access to this record")} sub={t('procurementDetail.accessDenied.sub', "This procurement record either doesn't exist or isn't visible to your role. If you created it, open it from your procurement list.")} /></div>
    </>;
  }
  const isRequester = p.requested_by_id === currentUser?.id;
  // SoD-b: a user cannot pay a request they themselves approved.
  const isApprover = !!currentUser?.id && p.approved_by_id === currentUser.id;
  // D8: sort so primary → outline/success → destructive (Cancel/Reject always last)
  // #803 (FR-APR-030/031/035): routing narrows who may decide. UX only — transition_procurement enforces.
  const routeAllows = mayDecideRoutedApproval(p.approvalRoute, currentUser?.id, realRole === 'Admin');
  const routeNote =
    p.approvalRoute && !routeAllows && !isRequester
      ? approvalRouteNote(p.approvalRoute, p.budget_category, t, realRole)
      : null;
  const hasValue = purchaseHasValue(p);
  const actions = sortActions(allowedActions(p.status, role, isRequester, isApprover, t, routeAllows, (p.payments?.length ?? 0) > 0, hasValue));
  const actionFor = (to: ProcurementStatus) => actions.find((action) => action.to === to);
  const stateMain = stateMainAction(p.status, actions, t);
  const transitionMainAction = stateMain?.transition;
  const mainAction = stateMain ? { ...stateMain.transition, label: stateMain.label } : undefined;
  const returnAction = p.status === 'Requested' ? actionFor('Rejected') : undefined;
  const secondaryTransitionActions = actions.filter((action) => action.to !== transitionMainAction?.to && action.to !== 'Rejected' && action.to !== 'Cancelled');
  const isEngineer = role === 'Engineer';
  const approverLimitLine = p.status === 'Requested' && !isRequester && routeAllows && p.approvalRoute
    ? p.approvalRoute.reason === 'within_budget'
      ? t('procurementRecord:approval.withinLimit', 'Within your limit')
      : t('procurementRecord:approval.goesTo', 'Goes to {{name}}', { name: p.approvalRoute.approvers.map((approver) => approver.fullName).join(' or ') })
    : null;
  const waitingNote = p.status === 'Requested' && isRequester
    ? isEngineer
      ? t('procurementRecord:waiting.engineerApproval', 'Waiting for approval by a project manager or Finance')
      : t('procurementRecord:waiting.approval', 'Waiting for approval')
    : p.status === 'Vendor Invoiced' && !actionFor('Paid')
      ? t('procurementRecord:waiting.payment', 'Payment: waiting for Finance')
      : null;
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
  // DD-EFK-1: separate Admin/Finance UX gate; the PMO setter RPC is the enforcement authority.
  const canRecordEfaktur = may('record_efaktur', 'procurementInvoice');
  const canWriteWithholdingSlip = may('create', 'vendorWithholdingSlip', { record: { viewOnly: effectiveRole !== realRole } });
  // 0002_rls.sql defines procurements_update for Admin, Executive, Project Manager, and Finance;
  // 0010_procurement_rls_hardening.sql preserves that row policy while narrowing writable columns.
  const canSetVendor = !p.vendor_id
    && effectiveRole === realRole
    && realRole != null
    && ['Admin', 'Executive', 'Project Manager', 'Finance'].includes(realRole)
    && may('edit', 'procurement');
  const canLinkAccounting = role === 'Admin' || role === 'Finance';
  const currentUserId = currentUser?.id ?? null;


  // Shared classified-toast helper for the CRUD section mutations.
  const onMutationError = (err: unknown) => {
    const { headline, detail } = classifyMutationError(err);
    toast(headline, detail, 'warning');
  };
  // 0349: where payment is blocked because the billed amount exceeds the approved amount, an eligible
  // approver (the Approve role set, never the requester) may approve the higher amount. UX only — the
  // server decides eligibility from the approval route and refuses the quote selector / bill recorder.
  const canApproveAmount = canApproveReject(role) && !isRequester;
  const approveHigherAmount = async (amount: number) => {
    try {
      await mutations.approveAmount.mutateAsync(amount);
      toast(t('procurement:ceiling.approved', 'Higher amount approved'), undefined, 'success');
    } catch (err) {
      onMutationError(err);
    }
  };
  const ceilingNotice = p.status === 'Vendor Invoiced' ? (
    <PaymentCeilingNotice
      ceiling={p.paymentCeiling}
      currency={p.currency}
      canApprove={canApproveAmount}
      busy={mutations.approveAmount?.isPending ?? false}
      onApprove={approveHigherAmount}
    />
  ) : null;
  // C3: the one line saying why "Mark as Paid" is absent — only to someone who would otherwise be offered it.
  const paidNeedsValue = !hasValue && INVOICE_PAY_ROLES.has(role) && !isApprover
    && ['Draft', 'Approved', 'Quote Selected', 'Ordered', 'Received', 'Vendor Invoiced'].includes(p.status)
    && ((p.payments?.length ?? 0) > 0 || p.status === 'Vendor Invoiced');
  const gateMsg = sodGateMessage(p, role, isRequester)
    ?? (paidNeedsValue ? t('procurement:detail.paidNeedsValue', 'Add a line item or a document with an amount before marking this paid.') : null);
  // SoD-b teaching at Vendor Invoiced: the viewer who may release payment learns why the approver cannot, and the
  // approver who cannot pay learns who can. Display-only; the transition RPC enforces it.
  const payerSodNote = p.status === 'Vendor Invoiced' && INVOICE_PAY_ROLES.has(role)
    ? isApprover
      ? t('procurementRecord:sod.approverCannotPay', "Payment must be released by a different finance user. The approver can't also pay this procurement.")
      : actionFor('Paid')
        ? t('procurementRecord:sod.payerHint', "Releasing payment: the approver can't also pay (separation of duties).")
        : null
    : null;
  const decisionContextNote = p.status === 'Requested' && isRequester ? null : gateMsg ?? (p.status === 'Requested' && !isRequester && actionFor('Approved')
    ? t('procurementRecord:sod.approverHint', 'You may approve or reject this procurement. The requester cannot self-approve. Separation of duties requires a different reviewer.')
    : payerSodNote);
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
  //
  // #571 — ONE key per shape, never "amount" + " on " + "…, requested by ". The optional project
  // and requester clauses are what forced the fragments, so each combination gets its own whole
  // sentence with the pieces as placeholders a translator can reorder.
  const moneyAmount = formatCurrency(Number(p.total_value), p.currency);
  const scheduledPayments = (p.payments ?? []).filter((payment) => payment.status === 'Scheduled');
  const payableInvoices = p.invoices.filter((invoice) => invoice.amount != null);
  const paidConfirmationAmount = scheduledPayments.length > 0
    ? scheduledPayments.reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0)
    : payableInvoices.length > 0
      ? payableInvoices.reduce((sum, invoice) => sum + Number(invoice.amount)
          + (invoice.tax_treatment === 'exclusive' ? Number(invoice.tax_amount ?? 0) : 0)
          - Number(invoice.withheld_amount ?? 0), 0)
      : Number(p.total_value);
  const paidMoneyAmount = formatCurrency(paidConfirmationAmount, p.currency);
  const moneyProject = p.project?.name ?? null;
  const moneyRequester = p.requested_by?.full_name ?? null;
  const moneyContext = moneyProject ? (
    moneyRequester ? (
      <Trans
        i18nKey="procurementDetail.confirm.moneyOnProjectRequestedBy"
        defaults="<amount>{{amount}}</amount> on <project/>, requested by <person>{{name}}</person>"
        values={{ amount: moneyAmount, name: moneyRequester }}
        components={{
          amount: <b />,
          project: <ProjectNameLink projectId={p.project_id} name={moneyProject} />,
          person: <i />,
        }}
      />
    ) : (
      <Trans
        i18nKey="procurementDetail.confirm.moneyOnProject"
        defaults="<amount>{{amount}}</amount> on <project/>"
        values={{ amount: moneyAmount }}
        components={{
          amount: <b />,
          project: <ProjectNameLink projectId={p.project_id} name={moneyProject} />,
        }}
      />
    )
  ) : moneyRequester ? (
    <Trans
      i18nKey="procurementDetail.confirm.moneyRequestedBy"
      defaults="<amount>{{amount}}</amount>, requested by <person>{{name}}</person>"
      values={{ amount: moneyAmount, name: moneyRequester }}
      components={{ amount: <b />, person: <i /> }}
    />
  ) : (
    <b>{moneyAmount}</b>
  );

  const onActionClick = (action: { to: ProcurementStatus; label: string; variant: ActionVariant }) => {
    setMutationError(null);
    if (action.to === 'Quote Selected') {
      setTab('quotes');
      return;
    }
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
        <Trans
          i18nKey="procurementDetail.confirm.approveBody"
          defaults="Approve <money/>?"
          components={{ money: <span>{moneyContext}</span> }}
        />
      ) : action.to === 'Paid' ? (
        <Trans
          i18nKey="procurementDetail.confirm.markPaidBody"
          defaults="Record {{amount}} as paid? This records payment evidence; it does not transfer funds."
          values={{ amount: paidMoneyAmount }}
        />
      ) : (
        t(
          'procurementDetail.confirm.terminal',
          'This is a terminal action for this procurement and cannot be undone.',
        )
      );
    setPendingConfirm({
      kind: 'transition',
      to: action.to,
      title: isCancel
        ? t('procurementDetail.confirm.cancelTitle', 'Cancel this procurement?')
        : destructive
          ? t('procurementDetail.confirm.destructiveTitle', '{{action}} this procurement', {
              action: action.label,
            })
          : `${action.label}?`,
      description,
      confirmLabel: action.label,
      cancelLabel: isCancel
        ? t('procurementDetail.confirm.keepRequest', 'Keep procurement')
        : undefined,
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
      toast(
        t('procurementDetail.toast.requestUpdated', 'Procurement updated'),
        `${t('procurementDetail.toast.movedTo', 'Moved to')} ${toastStateLabel(to)}`,
        'success',
      );
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
          intent: pendingConfirm.intent,
        });
        setShowCreateGR(false);
        toast(t('procurementDetail.toast.grRecorded', 'Goods receipt recorded'), undefined, 'success');
      } else {
        await mutations.createInvoice.mutateAsync({
          status: pendingConfirm.status,
          invoiceDate: pendingConfirm.invoiceDate,
          referenceNumber: pendingConfirm.referenceNumber,
          externalRef: pendingConfirm.externalRef,
          amount: pendingConfirm.amount,
          // #505: forwarded from the staged capture — required by the mutation's type.
          taxTreatment: pendingConfirm.taxTreatment,
          taxAmount: pendingConfirm.taxAmount,
          taxRate: pendingConfirm.taxRate, taxBaseNumerator: pendingConfirm.taxBaseNumerator, taxBaseDenominator: pendingConfirm.taxBaseDenominator,
          ...(pendingConfirm.taxTemplate ? { taxTemplate: pendingConfirm.taxTemplate } : {}),
          ...(pendingConfirm.withheldAmount && pendingConfirm.withheldPphType
            ? { withheldAmount: pendingConfirm.withheldAmount, withheldPphType: pendingConfirm.withheldPphType } : {}),
          ...(pendingConfirm.erpTaxAmounts ? { erpTaxAmounts: pendingConfirm.erpTaxAmounts } : {}),
          intent: pendingConfirm.intent,
        });
        setShowCreateVI(false);
        toast(t('procurementDetail.toast.viRecorded', 'Supplier invoice recorded'), undefined, 'success');
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

  // O3 (AC-W3-O3) + harden #2: submit the inline VI capture atomically. The transition to Vendor
  // Invoiced + the invoice-create + the status-event log now happen in ONE transactional RPC
  // (capture_vendor_invoice), so a partial failure can never leave the case at Vendor Invoiced with
  // no invoice (or vice versa) — it is all-or-nothing. Exactly ONE toast: a combined success, or the
  // classified failure. On FAILURE the inline panel STAYS OPEN so the user can correct + retry
  // without hunting for the recovery after-form; only a success closes it.
  const submitVICapture = async (capture: VendorInvoiceCapture) => {
    setMutationError(null);
    try {
      await mutations.captureVendorInvoice.mutateAsync({
        // #505: `capture` is `CaptureVendorInvoiceInput` minus procurementId/notes, so the tax facts
        // travel through by construction — there is no field list here to forget to update.
        ...capture,
        notes: notesInput || undefined,
      });
      setNotesInput('');
      setShowVICapture(false);
      toast(
        t('procurementDetail.toast.viRecorded', 'Supplier invoice recorded'),
        `${t('procurementDetail.toast.movedTo', 'Moved to')} ${toastStateLabel('Vendor Invoiced')}`,
        'success',
      );
    } catch (err) {
      // Keep the form open (do NOT close) — the atomic RPC rolled everything back, so the user
      // can fix the input and resubmit from the same panel.
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
      setMutationError(detail);
    }
  };

  const confirmInFlight =
    mutations.transition.isPending ||
    mutations.createReceipt.isPending ||
    mutations.createInvoice.isPending ||
    mutations.captureVendorInvoice.isPending;

  // The separator goes BETWEEN present parts only — a purchase with no request number (e.g. one created from an ERPNext
  // document) must not start with a stray "·".
  const meta = [
    p.code ? <span key="code" className="font-mono">{p.code}</span> : null,
    p.project?.name ? <ProjectNameLink key="proj" projectId={p.project_id} name={projectDisplayName(p.project)} legalName={p.project.name} /> : null,
    p.vendor?.name ? <CompanyNameLink key="supplier" companyId={p.vendor_id} name={p.vendor.name} /> : <span key="supplier-missing">{t('procurementRecord:status.supplierNotChosen', 'Supplier not chosen yet')}</span>,
    p.requested_by?.full_name ? <span key="req" className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="grid size-6 place-items-center rounded-full bg-secondary text-[12px] font-semibold text-secondary-foreground">{p.requested_by.full_name.trim().slice(0, 1).toUpperCase()}</span><span>{t('procurementRecord:meta.raisedBy', 'Raised by')} {p.requested_by.full_name}</span></span> : null,
  ].filter((part): part is React.ReactElement => part !== null)
    .map((part, i) => <span key={String(part.key)}>{i > 0 && ' · '}{part}</span>);

  // Overview Detail <dl> rows (the Field grammar). Vendor / Approved-by read a muted
  // "Not yet selected" / "Pending" while absent rather than a bare blank (G5 honesty).
  const detailRows: DetailRow[] = [
    {
      label: t('procurementDetail.detail.project', 'Project'),
      value: p.project?.name ? (
        <ProjectNameLink projectId={p.project_id} name={projectDisplayName(p.project)} legalName={p.project.name} />
      ) : (
        <span className="text-muted-foreground">{t('procurementDetail.detail.notLinked', 'Not linked')}</span>
      ),
    },
    {
      label: t('procurementRecord:details.supplier', 'Supplier'),
      value: p.vendor?.name ? (
        <CompanyNameLink companyId={p.vendor_id} name={p.vendor.name} />
      ) : (
        <span className="text-muted-foreground">
          {t('procurementDetail.detail.notYetSelected', 'Not yet selected')}
        </span>
      ),
    },
    {
      label: t('procurementDetail.detail.requestedBy', 'Requested by'),
      value: p.requested_by?.full_name ?? (
        <span className="text-muted-foreground">—</span>
      ),
    },
    {
      label: t('procurementDetail.detail.approvedBy', 'Approved by'),
      value: p.approved_by?.full_name ?? (
        <span className="text-muted-foreground">{stageForStatus(p.status) === 'Request' ? t('procurementDetail.detail.pending', 'Pending') : '—'}</span>
      ),
    },
    { label: t('procurementRecord:details.budgetCategory', 'Budget category'), value: p.budget_category || '—' },
    {
      label: t('procurementRecord:details.accountingStatus', 'Accounting-system status'),
      value: t('procurementRecord:details.accountingStatusValue', { defaultValue: '{{orders}} · {{docs}}', orders: t('procurementRecord:details.purchaseOrders', { count: p.purchase_orders.length, defaultValue: '{{count}} purchase orders' }), docs: t('procurementRecord:details.documentsLinked', { count: linkedDocs.length, defaultValue: '{{count}} documents linked' }) }),
    },
  ];

  // Counts are derived from the loaded records; SharePoint references stay out.
  const ledgerRows = buildLedgerRows(p);
  const documentsCount = ledgerRows.length + linkedDocs.length + p.statusEvents.length;
  // FR-PFE-038: a SharePoint link can be attached to any record of the purchase or a linked ERP document.
  const attachTypeName: Record<LedgerRow['type'], string> = {
    PR: t('procurement:documents.type.pr', 'Purchase request'), RFQ: t('procurement:documents.type.rfq', 'Quote request'),
    Quote: t('procurement:documents.type.quote', 'Quotation'), PO: t('procurement:documents.type.po', 'Purchase order'),
    GR: t('procurement:documents.type.gr', 'Goods receipt'), Invoice: t('procurement:documents.type.invoice', 'Supplier invoice'),
    Payment: t('procurement:documents.type.payment', 'Payment'),
  };
  // Labelled by type + number (never a raw id); a record with no number yet is just its type.
  const attachTargets = [
    ...ledgerRows.map((r) => ({
      value: `${LEDGER_KIND[r.type]}:${r.recordId}`,
      label: r.systemNumber ? `${attachTypeName[r.type]} ${r.systemNumber}` : attachTypeName[r.type],
      recordKind: LEDGER_KIND[r.type], recordId: r.recordId,
    })),
    ...(linkedDocs ?? []).map((d) => ({
      value: `erp_document:${d.id}`, label: `${erpDoctypeLabel(t, d.doctype)} ${d.name}`, recordKind: 'erp_document' as const, recordId: d.id,
    })),
  ];
  const procTabs: TabItem<ProcTab>[] = [
    { value: 'timeline', label: t('procurementRecord:tabs.timeline', 'Timeline'), count: documentsCount || null },
    {
      value: 'items',
      label: t('procurementRecord:tabs.items', 'Line items'),
      count: p.items.length || null,
    },
    {
      value: 'quotes',
      label: t('procurementRecord:tabs.quotes', 'Quotations'),
      count: p.quotations.length || null,
    },
    { value: 'files', label: t('procurementRecord:tabs.files', 'Files'), count: ledgerRows.reduce((sum, row) => sum + row.fileCount, 0) || null },
    { value: 'details', label: t('procurementRecord:tabs.details', 'Details') },
  ];
  // AC-IXD-PROC-005: a closed procurement (Paid, Cancelled, Rejected) takes no new documents — same rule as the Files-tab capture row.
  const isClosed = p.status === 'Paid' || p.status === 'Cancelled' || p.status === 'Rejected';
  const recordKinds = isClosed ? [] : recordableFirstKinds({
    canSource: canSource(role),
    canReceive: isRequester || RECEIPT_ROLES.has(role),
    canInvoicePay: INVOICE_PAY_ROLES.has(role),
  });
  const recordKindLabels: Record<RecordKind, string> = {
    purchase_request: t('procurementRecord:record.purchaseRequest', 'Purchase request'),
    rfq: t('procurementRecord:record.quoteRequest', 'Quote request'),
    purchase_order: t('procurementRecord:record.purchaseOrder', 'Purchase order'),
    goods_receipt: t('procurementRecord:record.receipt', 'Receipt'),
    vendor_invoice: t('procurementRecord:record.supplierInvoice', 'Supplier invoice'),
    payment: t('procurementRecord:record.payment', 'Payment'),
  };
  const beginCapture = (kind: RecordKind) => {
    setRecordMenuOpen(false);
    setCaptureKind(kind);
  };
  const createCapturedRecord = (input: CreateRecordInput) => {
    if (captureKind === 'purchase_request') return recordMutations.createPurchaseRequest.mutateAsync(input as Parameters<typeof recordMutations.createPurchaseRequest.mutateAsync>[0]);
    if (captureKind === 'rfq') return recordMutations.createRfq.mutateAsync(input as Parameters<typeof recordMutations.createRfq.mutateAsync>[0]);
    if (captureKind === 'purchase_order') return recordMutations.createPurchaseOrder.mutateAsync(input as Parameters<typeof recordMutations.createPurchaseOrder.mutateAsync>[0]);
    if (captureKind === 'payment') return recordMutations.createPayment.mutateAsync(input as Parameters<typeof recordMutations.createPayment.mutateAsync>[0]);
    return Promise.resolve(undefined);
  };
  const busyCapturing = captureKind === 'purchase_request' ? recordMutations.createPurchaseRequest.isPending
    : captureKind === 'rfq' ? recordMutations.createRfq.isPending
      : captureKind === 'purchase_order' ? recordMutations.createPurchaseOrder.isPending
        : captureKind === 'payment' ? recordMutations.createPayment.isPending
          : captureKind === 'goods_receipt' ? mutations.createReceipt.isPending
            : captureKind === 'vendor_invoice' ? mutations.createInvoice.isPending : false;
  const clickMainAction = () => {
    if (!mainAction) return;
    if (mainAction.to === 'Received') {
      setShowCreateGR(true);
      return;
    }
    if (mainAction.to === 'Vendor Invoiced') {
      setShowVICapture(true);
      return;
    }
    onActionClick(transitionMainAction ?? mainAction);
  };
  // B4: the list drawer's main action hands off here (router state, never the URL, so a shared link can't start a
  // step). It runs only when this page still offers that same step, then the hand-off is cleared.
  const handoffTarget = (location.state as { runMainAction?: ProcurementStatus } | null)?.runMainAction;
  const runHandoff = () => {
    const { runMainAction: _consumed, ...rest } = (location.state ?? {}) as Record<string, unknown>;
    navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: Object.keys(rest).length ? rest : null });
    if (mainAction && mainAction.to === handoffTarget) clickMainAction();
  };
  const secondaryClick = () => {
    if (returnAction) onActionClick(returnAction);
    else setTab('quotes');
  };
  const openQuotationCapture = () => {
    if (tabParam === 'quotes') {
      document.querySelector<HTMLButtonElement>('[data-testid="add-quotation"]')?.click();
      return;
    }
    quoteAutoOpen.current = true;
    setTab('quotes');
  };
  const exportCurrentProcurement = () => {
    const csv = ['number,title,status,project,supplier', [p.code ?? '', p.title, p.status, p.project?.name ?? '', p.vendor?.name ?? ''].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')].join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `${p.code ?? 'procurement'}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div>
      {/* C-IMP-1 (AC-S6-3): BackBar on mobile success render ≤920px.
          The top-bar breadcrumb owns desktop wayfinding (I7); on mobile the rail
          is collapsed and the breadcrumb is not visible, so the BackBar is the
          only in-content escape. CSS-only visibility: `hidden` on desktop,
          `max-[920px]:block` on mobile — single DOM, no dual a11y tree. */}
      <div data-testid="mobile-back-bar" className="hidden max-[920px]:block">
        <BackBar label={t('procurementDetail.backToProcurement', 'Procurement')} onBack={goBack} />
      </div>

      {handoffTarget && <RunOnMount run={runHandoff} />}
      {/* The record header carries the one current-stage action and document/menu actions. */}
      <RecordHeader
        variant="drawer"
        className="mb-4"
        icon={null}
        name={p.title}
        status={
          <span data-testid="procurement-status-badge" data-status={p.status}>
            <StatusPill variant={pillVariantForStatus(p.status)}>
              {p.status === 'Vendor Invoiced' ? t('procurementRecord:status.invoicedNotPaid', 'Invoiced, not paid')
                : p.status === 'Vendor Quoted' ? t('procurementRecord:status.quotationReceived', 'Quotation received')
                  : p.status === 'Quote Selected' ? t('procurementRecord:status.quoteChosen', 'Quote chosen')
                    : p.status === 'Rejected' ? t('procurementRecord:status.returned', 'Returned')
                      : stageLabelForStatus(p.status)}
            </StatusPill>
          </span>
        }
        meta={meta.length ? <span>{meta}</span> : undefined}
        actions={<div className="flex flex-wrap items-center justify-end gap-2">
          {waitingNote && <span className="whitespace-nowrap text-[12px] text-muted-foreground">{waitingNote}</span>}
          {(recordKinds.length > 0 || canAddQuote || canLinkAccounting) && <div className="relative hidden sm:block">
            <Button variant="outline" size="sm" aria-expanded={recordMenuOpen} onClick={() => setRecordMenuOpen((open) => !open)}>
              {t('procurementRecord:recordAnother', 'Record another document')} <Icon name="chev" className="size-3.5 rotate-90" />
            </Button>
            {recordMenuOpen && <div role="menu" aria-label={t('procurementRecord:recordMenu', 'Record another document')} className="absolute right-0 top-full z-30 mt-1 min-w-56 rounded-md border border-border bg-card p-1 shadow-lg">
              {recordKinds.map((kind) => <button key={kind} type="button" role="menuitem" className="block min-h-10 w-full rounded-sm px-3 text-left text-[13px] hover:bg-accent" onClick={() => beginCapture(kind)}>{recordKindLabels[kind]}</button>)}
              {canAddQuote && <button type="button" role="menuitem" className="block min-h-10 w-full rounded-sm px-3 text-left text-[13px] hover:bg-accent" onClick={() => { openQuotationCapture(); setRecordMenuOpen(false); }}>{t('procurementRecord:action.addQuote', 'Add quotation')}</button>}
              {canLinkAccounting && <button type="button" role="menuitem" className="block min-h-10 w-full rounded-sm px-3 text-left text-[13px] hover:bg-accent" onClick={() => { setRecordMenuOpen(false); setLinkDialogOpen(true); }}>{t('procurementRecord:linkAccounting', 'Link from accounting system')}</button>}
            </div>}
          </div>}
          {approverLimitLine && <span className="hidden text-[12px] text-muted-foreground lg:inline">{approverLimitLine}</span>}
          {returnAction && <Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={secondaryClick}>{t('procurementDetail.action.reject', 'Reject')}</Button>}
          {p.status === 'Approved' && canAddQuote && <Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={openQuotationCapture}>{t('procurementRecord:action.addQuote', 'Add quotation')}</Button>}
          {/* B4: below 640px the phone action bar owns the one filled main action. */}
          {mainAction && !isNarrow && <Button variant="primary" size="sm" disabled={mainAction.to === 'Requested' && p.items.length === 0} onClick={clickMainAction}>{mainAction.label}</Button>}
          <div className="relative">
            <Button variant="outline" size="sm" className="hidden sm:inline-flex" aria-label={t('procurementRecord:moreActions', 'More procurement actions')} aria-expanded={moreMenuOpen} onClick={() => setMoreMenuOpen((open) => !open)}>⋯</Button>
            {moreMenuOpen && <div role="menu" aria-label={t('procurementRecord:moreActions', 'More procurement actions')} className="absolute right-0 top-full z-30 mt-1 hidden min-w-48 rounded-md border border-border bg-card p-1 shadow-lg sm:block">
              {canEditHeader && <button type="button" role="menuitem" data-testid="edit-header" className="block min-h-10 w-full rounded-sm px-3 text-left text-[13px] hover:bg-accent" onClick={() => { setHeaderEditOpen(true); setMoreMenuOpen(false); }}>{t('procurementRecord:editDetails', 'Edit details')}</button>}
              <button type="button" role="menuitem" className="block min-h-10 w-full rounded-sm px-3 text-left text-[13px] hover:bg-accent" onClick={() => { setHistoryOpen(true); setTab('timeline'); setMoreMenuOpen(false); }}>{t('procurementRecord:timeline.fullHistory', 'Full history')}</button>
              {recordKinds.map((kind) => <button key={kind} type="button" role="menuitem" className="block min-h-10 w-full rounded-sm px-3 text-left text-[13px] hover:bg-accent sm:hidden" onClick={() => { beginCapture(kind); setMoreMenuOpen(false); }}>{recordKindLabels[kind]}</button>)}
              {canLinkAccounting && <button type="button" role="menuitem" className="block min-h-10 w-full rounded-sm px-3 text-left text-[13px] hover:bg-accent sm:hidden" onClick={() => { setLinkDialogOpen(true); setMoreMenuOpen(false); }}>{t('procurementRecord:linkAccounting', 'Link from accounting system')}</button>}
              {canEditHeader && <button type="button" role="menuitem" className="block min-h-10 w-full rounded-sm px-3 text-left text-[13px] hover:bg-accent sm:hidden" onClick={() => { setHeaderEditOpen(true); setMoreMenuOpen(false); }}>{t('procurementRecord:editDetails', 'Edit details')}</button>}
              {secondaryTransitionActions.map((action) => <button key={action.to} type="button" role="menuitem" className="block min-h-10 w-full rounded-sm px-3 text-left text-[13px] hover:bg-accent" onClick={() => { onActionClick(action); setMoreMenuOpen(false); }}>{action.label}</button>)}
              <button type="button" role="menuitem" className="block min-h-10 w-full rounded-sm px-3 text-left text-[13px] hover:bg-accent" onClick={() => { exportCurrentProcurement(); setMoreMenuOpen(false); }}>{t('procurementRecord:export', 'Export')}</button>
              {returnAction && <button type="button" role="menuitem" className="block min-h-10 w-full rounded-sm px-3 text-left text-[13px] text-destructive hover:bg-accent" onClick={() => { onActionClick(returnAction); setMoreMenuOpen(false); }}>{t('procurementDetail.action.reject', 'Reject')}</button>}
              {actionFor('Cancelled') && <button type="button" role="menuitem" className="block min-h-10 w-full rounded-sm px-3 text-left text-[13px] text-destructive hover:bg-accent" onClick={() => { onActionClick(actionFor('Cancelled')!); setMoreMenuOpen(false); }}>{t('procurementRecord:cancelProcurement', 'Cancel procurement')}</button>}
            </div>}
          </div>
        </div>}
      />

      {mutationError && <p role="alert" data-testid="procurement-mutation-error" className="mb-3 rounded-md border border-destructive/25 bg-destructive/[0.04] px-3 py-2 text-[13px] text-destructive-text">{mutationError}</p>}
      <div className="space-y-3">
        <ProcurementStageTracker procurement={p} linkedDocuments={linkedDocs} />
        <ProcurementMoneySummary procurement={p} linkedDocuments={linkedDocs} isEngineer={isEngineer} budgetSignal={isEngineer ? undefined : <ProcurementBudgetSignal
          projectId={p.project_id}
          totalValue={Number(p.total_value)}
          status={p.status}
          currency={p.currency}
        />} />
      </div>
      {ceilingNotice && <div className="mt-2">{ceilingNotice}</div>}
      {stageForStatus(p.status) === 'Request' && p.project_id && <DecisionSupportPanel
        projectId={p.project_id}
        totalValue={Number(p.total_value)}
        projectName={p.project ? projectDisplayName(p.project) : null}
        projectLegalName={p.project?.name}
        status={p.status}
        currency={p.currency}
      />}
      {approverLimitLine && <p className="mt-2 text-[12.5px] font-medium text-muted-foreground">{approverLimitLine}</p>}
      {decisionContextNote && <p data-testid="sod-ready-hint" className="mb-3 text-[12.5px] text-muted-foreground">{decisionContextNote}</p>}
      {isDraft && p.items.length === 0 && mainAction?.to === 'Requested' && <p data-testid="line-items-gate" className="mb-3 text-[12.5px] text-muted-foreground">{t('procurementRecord:gate.addLineItem', 'Add at least one line item before submitting.')}</p>}
      {isDraft && isRequester && <p data-testid="sod-pre-announce" className="mb-3 text-[12.5px] text-muted-foreground">{t('procurementRecord:sod.preAnnounce', "Submitting hands this to another approver. You can't approve your own procurement.")}</p>}
      {routeNote && !(showVICapture || showCreateGR || showCreateVI) && <p data-testid="approval-route-note" className="mb-3 text-[12.5px] text-muted-foreground">{routeNote}</p>}
      {mainAction?.to === 'Approved' && <label className="mb-4 mt-2 block max-w-xl text-[12px] font-medium text-muted-foreground">{t('procurementRecord:approval.note', 'Approval note (optional)')}
        <textarea data-testid="procurement-notes-input" value={notesInput} onChange={(event) => setNotesInput(event.target.value)} rows={2} className="mt-1 block w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" />
      </label>}
      {/* Draft-header edit (requester while Draft/Rejected) — opened from the header Edit action */}
      {canEditHeader && headerEditOpen && (
        <ProcurementHeaderEdit
          title={p.title}
          projectId={p.project_id}
          projectName={p.project?.name ?? null}
          vendorId={p.vendor_id}
          vendorName={p.vendor?.name ?? null}
          budgetCategory={p.budget_category}
          busy={crud.updateHeader.isPending}
          onError={onMutationError}
          onClose={() => setHeaderEditOpen(false)}
          onSave={async (patch) => {
            await crud.updateHeader.mutateAsync(patch);
            toast(
              t('procurementDetail.toast.requestUpdated', 'Procurement updated'),
              t('procurementDetail.toast.headerSaved', 'Header saved'),
              'success',
            );
          }}
        />
      )}

      {/* Deep-linkable detail sections */}
      <Tabs<ProcTab>
        items={procTabs}
        value={tab}
        onChange={setTab}
        ariaLabel={t('procurementDetail.tabsLabel', 'Procurement sections')}
        idBase="procurement-detail"
      />

      <div
        role="tabpanel"
        id={tabPanelId('procurement-detail', tab)}
        aria-labelledby={tabId('procurement-detail', tab)}
        data-testid={`procurement-tabpanel-${tab}`}
      >
        {tab === 'timeline' && <div className="space-y-4">
          <ProcurementTimeline procurement={p} ledgerRows={ledgerRows} linkedDocuments={linkedDocs} isEngineer={isEngineer} canWriteFiles={canManageFiles} uploadedById={currentUserId} onFullHistory={() => setHistoryOpen((open) => !open)} />
          {historyOpen && <Card data-testid="procurement-full-history"><CardHead actions={<Button variant="outline" size="sm" onClick={() => setHistoryOpen(false)}>{t('procurementRecord:close', 'Close')}</Button>}>{t('procurementRecord:timeline.fullHistory', 'Full history')}</CardHead><CardPad><RecordHistory entityType="procurement" entityId={p.id} includeChildren /></CardPad></Card>}
        </div>}

        {tab === 'items' && (
          <div className="space-y-2">
          <p className="text-[12.5px] text-muted-foreground">{p.items.length} {t('procurementRecord:items.countLabel', 'line items')}</p>
          <LineItemsSection
            erpItems={erpItems.connected ? erpItems : undefined}
            items={p.items}
            editable={canEditItems}
            busy={crud.createItem.isPending || crud.updateItem.isPending || crud.deleteItem.isPending}
            onError={onMutationError}
            onAdd={async (input) => {
              await crud.createItem.mutateAsync(input);
              toast(t('procurementDetail.toast.lineItemAdded', 'Line item added'), input.name, 'success');
            }}
            onUpdate={async (id, patch) => {
              await crud.updateItem.mutateAsync({ id, patch });
              toast(t('procurementDetail.toast.lineItemUpdated', 'Line item updated'), patch.name, 'success');
            }}
            onDelete={async (id) => {
              await crud.deleteItem.mutateAsync(id);
              toast(t('procurementDetail.toast.lineItemRemoved', 'Line item removed'), undefined, 'success');
            }}
            currency={p.currency}
          />
          </div>
        )}

        {/* ░░ Documents tab — Slice 2: ProcurementLedger (the single case ledger).
            All 7 record types, chronological, one row each. Filter chips: All /
            Financial / Has file. Capture affordance at bottom (LedgerCaptureRow).
            ProcurementRecordsSection / DocRow / ProcurementDocumentsSection removed. ░░ */}
        {tab === 'files' && (
          <Card variant="bare">
            {!isEngineer ? <ProcurementLedger
              detail={p}
              rows={ledgerRows}
              procurementId={p.id}
              uploadedById={currentUserId}
              canWrite={canManageFiles}
              canRecordEfaktur={canRecordEfaktur}
              efakturSaving={mutations.setEfaktur.isPending}
              onSetEfaktur={async (invoiceId, values) => {
                await mutations.setEfaktur.mutateAsync({ invoiceId, ...values });
                toast(
                  t('efaktur.saved', 'e-Faktur details saved'),
                  p.invoices?.find((inv) => inv.id === invoiceId)?.vi_number ?? undefined,
                  'success',
                );
              }}
              invoices={p.invoices}
              targetInvoiceId={targetInvoiceId ?? undefined}
              canWriteWithholdingSlip={canWriteWithholdingSlip}
              vendorMissing={!p.vendor_id}
              onSetVendor={canSetVendor ? () => { setSelectedVendorId(null); setVendorPickerOpen(true); } : undefined}
              onRecordWithholdingSlip={(invoice) => setRecordSlipInvoice(invoice)}
              onViewWithholdingSlip={(slipId) => setBupotSelection(slipId)}
              onWithholdingHistory={(invoiceId) => { historyReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setSlipHistoryInvoiceId(invoiceId); }}
              isApprover={isApprover}
              firstDocumentKinds={recordableFirstKinds({
                canSource: canSource(role),
                canReceive: isRequester || RECEIPT_ROLES.has(role),
                canInvoicePay: INVOICE_PAY_ROLES.has(role),
              })}
              autoOpenFirstDocument={autoOpenFirstDocument}
              onAutoOpenFirstDocumentConsumed={() => setAutoOpenFirstDocument(null)}
              canApprove={canApproveAmount}
              onStageRecord={(staged) => { setMutationError(null); setPendingConfirm(staged); }}
              vendorId={p.vendor_id}
              itemsNet={itemsNetTotal(p.items)}
              gates={gates}
            /> : <ProcurementTimeline procurement={p} ledgerRows={ledgerRows} linkedDocuments={linkedDocs} isEngineer canWriteFiles={canManageFiles} uploadedById={currentUserId} onFullHistory={() => { setHistoryOpen(true); setTab('timeline'); }} />}
            {vendorPickerOpen && canSetVendor && (
              <div role="dialog" aria-label={t('bupot.setVendor', 'Set supplier')} className="mt-3 flex flex-wrap items-end gap-3 rounded-md border border-border p-3">
                <Combobox
                  label={t('bupot.vendor', 'Supplier')}
                  noun={t('bupot.vendor', 'Supplier').toLowerCase()}
                  value={selectedVendorId}
                  onChange={(value) => setSelectedVendorId(value)}
                  loadOptions={async () => vendorOptions ?? []}
                  placeholder={t('bupot.selectVendor', 'Select a supplier…')}
                />
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!selectedVendorId || crud.updateVendor.isPending}
                  onClick={async () => {
                    if (!selectedVendorId) return;
                    try {
                      await crud.updateVendor.mutateAsync(selectedVendorId);
                      setVendorPickerOpen(false);
                      toast(t('bupot.vendorSet', 'Supplier set'), undefined, 'success');
                    } catch (err) {
                      if ((err as { code?: string })?.code === 'VENDOR_ALREADY_SET') {
                        setVendorPickerOpen(false);
                        toast(
                          t('bupot.vendorAlreadySet', 'A supplier was already set. Refresh to see it.'),
                          undefined,
                          'warning',
                        );
                        await detailQuery.refetch();
                        return;
                      }
                      onMutationError(err);
                    }
                  }}
                >{t('bupot.saveVendor', 'Save supplier')}</Button>
                <Button variant="outline" size="sm" onClick={() => setVendorPickerOpen(false)}>{t('bupot.cancelSetVendor', 'Cancel')}</Button>
              </div>
            )}
            {!isEngineer && <LinkedErpDocuments procurementId={p.id} />}
            <ProcurementMicrosoftReferences procurementId={p.id} requestNumber={p.pr_number} createdAt={p.created_at} targets={attachTargets} />
          </Card>
        )}

        {/* ░░ Vendor quotes tab — Slice 3: VendorQuotesTab (bid comparison).
            Refactors QuotationsSection into a side-by-side comparison layout:
            Vendor / Amount / Valid until · selected row highlighted + won pill.
            Reuses the existing selectQuote RPC + SoD/role gating unchanged. ░░ */}
        {/* #878: PR/RFQ/PO/payment are filed under their PROCUREMENT (0277), so the document
            children roll up here — the project reaches them on read through this procurement. */}

        {tab === 'quotes' && (
          <>
          {p.quotations.length > 0 && <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="quotation-comparison-cards">
            {p.quotations.map((quote) => {
              const chosen = selectedQuote?.id === quote.id;
              const baseline = selectedQuote ? Number(selectedQuote.total_amount) : null;
              const difference = baseline != null && !chosen ? Number(quote.total_amount) - baseline : null;
              const percent = difference != null && baseline != null && baseline !== 0 ? (difference / baseline) * 100 : null;
              const supplierName = vendorMap[quote.vendor_id] ?? (quote.vendor_id === p.vendor_id ? p.vendor?.name : null) ?? quote.vq_number ?? t('procurementRecord:details.supplier', 'Supplier');
              return <article key={quote.id} className="rounded-md border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="min-w-0 break-words text-[14px] font-semibold">{supplierName}</h2>
                  {chosen && <StatusPill variant="won">{t('procurementRecord:quotes.chosen', 'Chosen')}</StatusPill>}
                </div>
                <p className="mt-3 text-[18px] font-semibold tabular-nums">{formatCurrency(Number(quote.total_amount), quote.currency)}</p>
                <p className="mt-1 text-[12px] text-muted-foreground">{t('procurementRecord:quotes.validUntil', 'Valid until')}: {quote.valid_until ?? '—'}</p>
                {difference != null && <p className="mt-2 text-[12px] text-muted-foreground">{t('procurementRecord:quotes.vsChosen', 'vs chosen')}: {difference > 0 ? '+' : ''}{formatCurrency(difference, quote.currency)}{percent == null ? '' : ` · ${percent > 0 ? '+' : ''}${percent.toFixed(1)}%`}</p>}
              </article>;
            })}
          </div>}
          <VendorQuotesTab
            quotations={p.quotations}
            selectedId={selectedQuote?.id ?? null}
            canAdd={canAddQuote}
            canSelect={canSelectQuote}
            addBusy={mutations.createQuotation.isPending}
            selectBusy={crud.selectQuote.isPending}
            procurementId={p.id}
            currency={p.currency}
            canManageFiles={canManageFiles}
            currentUserId={currentUserId}
            vendorMap={vendorMap}
            onError={onMutationError}
            onAdd={async (input) => {
              await mutations.createQuotation.mutateAsync(input);
              toast(t('procurementDetail.toast.quotationAdded', 'Quotation added'), undefined, 'success');
            }}
            onSelect={async (quotationId) => {
              // The server returns the request for approval when the quote exceeds the approved
              // amount (0349); say which outcome happened rather than always "advanced".
              const quote = p.quotations.find((q) => q.id === quotationId);
              const rerouted = p.approved_total_value != null && quote != null
                && Number(quote.total_amount) > Number(p.approved_total_value);
              await crud.selectQuote.mutateAsync(quotationId);
              toast(
                t('procurementDetail.toast.quoteSelected', 'Quote selected'),
                rerouted
                  ? t(
                      'procurement:quoteSelection.reroutedDetail',
                      'The quote is above the approved amount, so the procurement went back for approval.',
                    )
                  : t(
                      'procurementDetail.toast.quoteSelectedDetail',
                      'The procurement advanced to Quote Selected',
                    ),
                'success',
              );
            }}
          />
          </>
        )}
        {tab === 'details' && <Card data-testid="procurement-detail-dl"><CardHead>{t('procurementRecord:tabs.details', 'Details')}</CardHead><CardPad>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            {detailRows.map((row) => <div key={row.label}><dt className="text-[12px] font-semibold text-muted-foreground">{row.label}</dt><dd className="mt-0.5 text-[13.5px]">{row.value}</dd></div>)}
          </dl>
          {canEditHeader && <Button className="mt-4" variant="outline" onClick={() => setHeaderEditOpen(true)}>{t('procurementRecord:editDetails', 'Edit details')}</Button>}
        </CardPad></Card>}
      </div>

      {captureKind && <div className="mt-4" data-testid="procurement-record-capture">
        <CardHead actions={<Button variant="outline" size="sm" onClick={() => setCaptureKind(null)}>{t('procurementRecord:close', 'Close')}</Button>}>{recordKindLabels[captureKind]}</CardHead>
        <RecordCaptureForm
          kind={captureKind}
          onCreate={createCapturedRecord}
          busy={busyCapturing}
          invoices={p.invoices}
          vendorId={p.vendor_id}
          itemsNet={itemsNetTotal(p.items)}
          currency={p.currency}
          onStage={(staged) => { setMutationError(null); setPendingConfirm(staged); }}
          onClose={() => setCaptureKind(null)}
        />
      </div>}

      {(showVICapture || showCreateGR || showCreateVI) && <ProcurementDecisionZone
        p={p}
        actions={[]}
        gateMsg={gateMsg}
        routeNote={routeNote}
        ceilingNotice={null}
        isDraft={isDraft}
        isRequester={isRequester}
        isApprover={isApprover}
        showNotes={false}
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
      />}

      {mainAction && isNarrow && <>
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card p-3 shadow-[0_-2px_10px_hsl(var(--foreground)/0.06)] sm:hidden">
          <div className="mx-auto flex max-w-3xl gap-2">
            <Button variant="primary" className="min-h-11 flex-1" disabled={mainAction.to === 'Requested' && p.items.length === 0} onClick={clickMainAction}>{mainAction.label}</Button>
            <Button variant="outline" className="min-h-11" aria-label={t('procurementRecord:moreActions', 'More procurement actions')} aria-expanded={moreMenuOpen} onClick={() => setMoreMenuOpen((open) => !open)}>⋯</Button>
          </div>
          {moreMenuOpen && <div role="menu" aria-label={t('procurementRecord:moreActions', 'More procurement actions')} className="mx-auto mt-2 max-h-[55vh] max-w-3xl overflow-y-auto rounded-md border border-border bg-card p-1 shadow-lg">
            {returnAction && <button type="button" role="menuitem" className="block min-h-10 w-full rounded-sm px-3 text-left text-[13px] hover:bg-accent" onClick={() => { secondaryClick(); setMoreMenuOpen(false); }}>{t('procurementRecord:action.return', 'Return')}</button>}
            {recordKinds.map((kind) => <button key={kind} type="button" role="menuitem" className="block min-h-10 w-full rounded-sm px-3 text-left text-[13px] hover:bg-accent" onClick={() => { beginCapture(kind); setMoreMenuOpen(false); }}>{recordKindLabels[kind]}</button>)}
            {canAddQuote && <button type="button" role="menuitem" className="block min-h-10 w-full rounded-sm px-3 text-left text-[13px] hover:bg-accent" onClick={() => { openQuotationCapture(); setMoreMenuOpen(false); }}>{t('procurementRecord:action.addQuote', 'Add quotation')}</button>}
            {canLinkAccounting && <button type="button" role="menuitem" className="block min-h-10 w-full rounded-sm px-3 text-left text-[13px] hover:bg-accent" onClick={() => { setLinkDialogOpen(true); setMoreMenuOpen(false); }}>{t('procurementRecord:linkAccounting', 'Link from accounting system')}</button>}
            {canEditHeader && <button type="button" role="menuitem" className="block min-h-10 w-full rounded-sm px-3 text-left text-[13px] hover:bg-accent" onClick={() => { setHeaderEditOpen(true); setMoreMenuOpen(false); }}>{t('procurementRecord:editDetails', 'Edit details')}</button>}
            <button type="button" role="menuitem" className="block min-h-10 w-full rounded-sm px-3 text-left text-[13px] hover:bg-accent" onClick={() => { setHistoryOpen(true); setTab('timeline'); setMoreMenuOpen(false); }}>{t('procurementRecord:timeline.fullHistory', 'Full history')}</button>
            {secondaryTransitionActions.map((action) => <button key={action.to} type="button" role="menuitem" className="block min-h-10 w-full rounded-sm px-3 text-left text-[13px] hover:bg-accent" onClick={() => { onActionClick(action); setMoreMenuOpen(false); }}>{action.label}</button>)}
            <button type="button" role="menuitem" className="block min-h-10 w-full rounded-sm px-3 text-left text-[13px] hover:bg-accent" onClick={() => { exportCurrentProcurement(); setMoreMenuOpen(false); }}>{t('procurementRecord:export', 'Export')}</button>
            {returnAction && <button type="button" role="menuitem" className="block min-h-10 w-full rounded-sm px-3 text-left text-[13px] text-destructive hover:bg-accent" onClick={() => { onActionClick(returnAction); setMoreMenuOpen(false); }}>{t('procurementDetail.action.reject', 'Reject')}</button>}
            {actionFor('Cancelled') && <button type="button" role="menuitem" className="block min-h-10 w-full rounded-sm px-3 text-left text-[13px] text-destructive hover:bg-accent" onClick={() => { onActionClick(actionFor('Cancelled')!); setMoreMenuOpen(false); }}>{t('procurementRecord:cancelProcurement', 'Cancel procurement')}</button>}
          </div>}
        </div>
        <div aria-hidden="true" className="h-16 sm:hidden" />
      </>}
      {linkDialogOpen && <LinkErpDocumentsDialog
        docs={(erpOrphanQuery.data ?? []) as ErpPurchaseRow[]}
        projectId={p.project_id ?? undefined}
        onClose={() => setLinkDialogOpen(false)}
        onLinked={() => { setLinkDialogOpen(false); void detailQuery.refetch(); toast(t('procurementRecord:erpLinked', 'Accounting-system document linked'), undefined, 'success'); }}
        onPartiallyLinked={(result) => { setLinkDialogOpen(false); void detailQuery.refetch(); toast(t('procurementRecord:erpLinked', 'Accounting-system document linked'), result.refused.join(' · '), 'warning'); }}
      />}

      {recordSlipInvoice && p.vendor_id && <VendorWithholdingSlipRecordForm
        invoice={recordSlipInvoice} vendorId={p.vendor_id} vendorName={vendorMap[p.vendor_id]} onClose={() => setRecordSlipInvoice(null)}
      />}
      {slipHistoryInvoiceId && <VendorWithholdingSlipHistory invoiceId={slipHistoryInvoiceId} onClose={() => { setSlipHistoryInvoiceId(null); requestAnimationFrame(() => historyReturnFocus.current?.focus()); }} onView={(id) => { setSlipHistoryInvoiceId(null); setBupotSelection(id); }} />}
      {bupotId && <VendorWithholdingSlipDetails
        slipId={bupotId}
        canWrite={may('edit', 'vendorWithholdingSlip', { record: { viewOnly: effectiveRole !== realRole } })}
        onClose={() => setBupotSelection(null)}
        suppressArrivalFocus={Boolean(targetInvoiceId)}
        onOpenProcurement={(id, slipId, invoiceId) => {
          const params = new URLSearchParams(location.search);
          params.set('bupot', slipId);
          params.set('bupotBill', invoiceId);
          navigate(`/procurement/${encodeURIComponent(id)}/files?${params.toString()}${location.hash}`);
        }}
      />}

      {/* P1-P4 — confirm-before-write. One dialog drives every staged mutation;
          forward steps + GR/VI are default-tone, Reject/Cancel are destructive. */}
      <ConfirmDialog
        open={pendingConfirm !== null}
        tone={pendingConfirm?.kind === 'transition' ? pendingConfirm.tone : 'default'}
        title={
          pendingConfirm?.kind === 'transition'
            ? pendingConfirm.title
            : pendingConfirm?.kind === 'createGR'
              ? t('procurementDetail.confirm.grTitle', 'Record this goods receipt?')
              : t('procurementDetail.confirm.viTitle', 'Record this supplier invoice?')
        }
        description={
          pendingConfirm?.kind === 'transition'
            ? pendingConfirm.description
            : pendingConfirm?.kind === 'createGR'
              ? t(
                  'procurementDetail.confirm.grBody',
                  'This records a {{status}} goods receipt against procurement record {{request}}.',
                  { status: pendingConfirm.status.toLowerCase(), request: p.title },
                )
              : t(
                  'procurementDetail.confirm.viBody',
                  'This records a supplier invoice against procurement record {{request}}.',
                  { request: p.title },
                )
        }
        confirmLabel={
          pendingConfirm?.kind === 'transition'
            ? pendingConfirm.confirmLabel
            : pendingConfirm?.kind === 'createGR'
              ? t('procurementDetail.confirm.saveGR', 'Save GR')
              : t('procurementDetail.confirm.saveVI', 'Save supplier invoice')
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

function VendorWithholdingSlipRecordForm({ invoice, vendorId, vendorName, onClose }: { invoice: ProcurementDetail['invoices'][number]; vendorId: string; vendorName?: string; onClose: () => void }) {
  const mutation = useVendorWithholdingSlipMutations();
  return <VendorWithholdingSlipModal invoice={invoice} vendorId={vendorId} vendorName={vendorName} open loading={mutation.record.isPending} onClose={onClose} onSave={(input) => mutation.record.mutateAsync(input)} />;
}

function VendorWithholdingSlipHistory({ invoiceId, onClose, onView }: { invoiceId: string; onClose: () => void; onView: (id: string) => void }) {
  const { t } = useTranslation();
  const query = useVendorWithholdingRegister({ invoiceId });
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  React.useLayoutEffect(() => { headingRef.current?.focus(); headingRef.current?.scrollIntoView?.({ block: 'nearest' }); }, []);
  const close = onClose;
  return <Card className="mt-3"><CardHead level={2} aria-label={t('bupot.history', 'Bukti potong history')} ref={headingRef} tabIndex={-1} actions={<Button variant="outline" onClick={close}>{t('bupot.close', 'Close')}</Button>}>{t('bupot.history', 'Bukti potong history')}</CardHead><CardPad>
    {query.isLoading ? <ListState variant="loading" rows={2} /> : query.isError ? <ListState variant="error" title={t('bupot.loadError', 'Bukti potong unavailable')} onRetry={() => void query.refetch()} retryLabel={t('bupot.retry', 'Retry')} /> : (query.data?.pages ?? []).flatMap((page) => page.rows).length === 0 ? <ListState variant="empty" title={t('bupot.noBillHistory', 'No withholding slips recorded for this bill.')} /> : <ul>{(query.data?.pages ?? []).flatMap((page) => page.rows).map((slip) => <li key={slip.slip_id} className="flex justify-between gap-2 py-2"><span className="break-all">{slip.slip_number} · {slip.status}</span><Button variant="outline" onClick={() => onView(slip.slip_id)}>{t('bupot.view', 'View bukti potong')}</Button></li>)}</ul>}
    {query.hasNextPage && <Button variant="outline" onClick={() => void query.fetchNextPage()}>{t('bupot.loadMoreSlips', 'Load more history')}</Button>}
  </CardPad></Card>;
}

export default ProcurementDetails;
