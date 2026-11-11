import { useDomainOwnershipMode } from '@/src/hooks/useDomainOwnershipMode';
import { useProcurementItemEligibility } from '@/src/hooks/useProcurementItemEligibility';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
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
  TextArea,
  Tabs,
  tabId,
  tabPanelId,
  useToast,
  useIsNarrow,
  ProjectNameLink,
  CompanyNameLink,
} from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { useProcurementDetail, useProcurementMutations } from '@/src/hooks/useProcurementDetail';
import { useProcurementCrudMutations } from '@/src/hooks/useProcurementCrud';
import { useProcurementRecordMutations } from '@/src/hooks/useProcurementRecords';
import { useErpOrphans } from '@/src/hooks/useErpPurchases';
import { useErpItemOptions } from '@/src/hooks/useErpItemOptions';
import { useProject } from '@/src/hooks/useProjects';
import { useVendorOptions } from '@/src/hooks/useFkOptions';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import { mayDecideRoutedApproval, approvalRouteNote } from '@/src/lib/procurement/approvalRoute';
import { withTabSwitchNavState } from '@/src/lib/tabSwitchNav';
import { useAuth } from '@/src/auth/useAuth';
import { ProcurementDetailsTab, ProcurementItemsTab, ProcurementQuotesTab } from './procurement/ProcurementDetailTabs';
import { procurementAttachTargets, procurementDetailRows, procurementTabs, tabFromParam, type ProcTab } from './procurement/procurementDetailView';
import { useProcurementDecision } from './procurement/useProcurementDecision';
import { PaymentCeilingNotice } from './procurement/PaymentCeilingNotice';
import { ProcurementHeaderEdit } from './procurement/ProcurementHeaderEdit';
import { ProcurementLedger } from './procurement/ProcurementLedger';
import { OdooCaseStatus } from './procurement/OdooCaseStatus';
import { useProcurementGates } from '@/src/hooks/useProcurementGates';
import { itemsNetTotal } from '@/src/lib/itemsNet';
import { purchaseHasValue } from '@/src/lib/procurement/purchaseValue';
import { recordableFirstKinds } from './procurement/firstDocument';
import { useLinkedErpDocuments } from '@/src/hooks/useErpPurchaseLinks';
import { LinkedErpDocuments } from './procurement/LinkedErpDocuments';
import { AttachedJournalLines } from './procurement/AttachedJournalLines';
import { ProcurementMicrosoftReferences } from './procurement/ProcurementMicrosoftReferences';
import { useProcurementWithholding } from './procurement/useProcurementWithholding';
import { VendorWithholdingSlipRecordForm, VendorWithholdingSlipHistory } from './procurement/ProcurementWithholding';
import { VendorWithholdingSlipDetails } from './procurement/VendorWithholdingSlipDetails';
import { ProcurementDecisionZone } from './procurement/ProcurementDecisionZone';
import { buildLedgerRows } from '@/src/lib/db/procurementLedger';
import {
  type ProcurementStatus,
  type ProcurementDetail,
} from '@/src/lib/db/procurementLifecycle';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useAgentContext } from '@/src/lib/agent/context/useAgentContext';
import { useListReturn } from '@/src/hooks/useListReturn';
import { RecordHistory } from '@/src/components/history/RecordHistory';
import { RecordCaptureForm, type CreateRecordInput, type RecordKind } from './procurement/RecordCaptureForm';
import { LinkErpDocumentsDialog } from './procurement/LinkErpDocumentsDialog';
import { DecisionSupportPanel } from './procurement/DecisionSupportPanel';
import { ProcurementBudgetSignal, ProcurementStageTracker, ProcurementMoneySummary, ProcurementTimeline } from './procurement/detail/ProcurementDetailPanels';
import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';
import { pillVariantForStatus, stageLabelForStatus, selectedQuotation } from '../components/procurement';
import { stageForStatus } from '@/src/lib/procurement/stage';
import {
  allowedActions,
  canApproveReject,
  canSource,
  INVOICE_PAY_ROLES,
  RECEIPT_ROLES,
  sodGateMessage,
  sortActions,
  stateMainAction,
} from '@/src/lib/procurement/mainAction';
// ---------------------------------------------------------------------------
// Tabbed record shell (mirrors ProjectDetail's `/projects/:id/:tab`). Default tab =
// Overview (status-at-a-glance: stepper above + the Overview bento). An absent/unknown
// :tab defaults to Overview and is role-invariant (CW-7); an explicit :tab always wins.
// ---------------------------------------------------------------------------
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

  const ownership = useDomainOwnershipMode('procurement');
  const itemEligibility = useProcurementItemEligibility(procurementId, ownership.mode === 'external');
  const detailQuery = useProcurementDetail(procurementId);
  const projectScopeQuery = useProject(realRole === 'Project Manager' ? detailQuery.data?.project_id ?? undefined : undefined);
  const linkedErpQuery = useLinkedErpDocuments(procurementId);
  const linkedDocs = linkedErpQuery.data ?? [];
  const gates = useProcurementGates().data;
  const mutations = useProcurementMutations(procurementId ?? '');
  const crud = useProcurementCrudMutations(procurementId ?? '');
  const recordMutations = useProcurementRecordMutations(procurementId ?? '');
  const erpItems = useErpItemOptions('purchase');
  const withholding = useProcurementWithholding();
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
  const vendorQuery = useVendorOptions();
  const { data: vendorOptions } = vendorQuery;
  const vendorReferencesReady = !vendorQuery.isPending && !vendorQuery.isError && vendorOptions !== undefined;
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
  const { pendingConfirm, setPendingConfirm, rejectionComment, setRejectionComment, onActionClick, commitConfirm, submitVICapture, confirmInFlight } =
    useProcurementDecision(detailQuery.data, mutations, {
      setTab, notesInput, setNotesInput, setMutationError, setShowCreateGR, setShowCreateVI, setShowVICapture, setCaptureKind,
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
          <ListState variant="loading" shape="detail" rows={6} />
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
              "This procurement case either doesn't exist or isn't visible to your role. If you created it, open it from your procurement list.",
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
      <div data-testid="procurement-loading"><ListState variant="loading" shape="detail" rows={6} /></div>
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
      <div data-testid="procurement-no-access"><ListState variant="empty" icon="lock" titleAsPageHeading title={t('procurementDetail.accessDenied.title', "You don't have access to this record")} sub={t('procurementDetail.accessDenied.sub', "This procurement case either doesn't exist or isn't visible to your role. If you created it, open it from your procurement list.")} /></div>
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
  // procurements and only to an authorized requester or an Admin. No archive/delete — Cancel is a lifecycle
  // transition in the action zone. RLS remains the enforcement authority.
  const canEditHeader =
    (isDraft || isRejected) && (isRequester || realRole === 'Admin') && may('edit', 'procurement');
  // Line items: requester OR PM/Finance/Admin while Draft (matches the 0015 RLS).
  const ownershipReady = ownership.mode === 'pmo' || ownership.mode === 'external';
  const canEditItems = ownershipReady && isDraft && (isRequester || may('edit', 'procItem'));
  const casePushInFlight = ownership.mode === 'external' && (
    mutations.pendingPush?.status === 'pushing' || recordMutations.pendingPush?.status === 'pushing'
    || mutations.createQuotation.isPending || mutations.createReceipt.isPending || mutations.createInvoice.isPending
    || recordMutations.createPurchaseRequest.isPending || recordMutations.createRfq.isPending
    || recordMutations.createPurchaseOrder.isPending || recordMutations.createPayment.isPending
  );
  const canEditItemValues = ownership.mode === 'pmo' || (ownership.mode === 'external' && !casePushInFlight && itemEligibility.data === true && !itemEligibility.isError && !itemEligibility.isFetching);
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
  const currentAmountApproval = canApproveAmount && !detailQuery.isPending && !detailQuery.isFetching && !detailQuery.isError && p.paymentEligibility === 'allowed';
  const approveHigherAmount = async (amount: number) => {
    if (!currentAmountApproval) return;
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
      canApprove={currentAmountApproval}
      eligibilityReason={detailQuery.isPending || detailQuery.isFetching ? 'checking' : detailQuery.isError ? 'unavailable' : p.paymentEligibility}
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

  // The separator goes BETWEEN present parts only — a purchase with no request number (e.g. one created from an ERPNext
  // document) must not start with a stray "·".
  const meta = [
    p.code ? <span key="code" className="font-mono">{p.code}</span> : null,
    p.project?.name ? <ProjectNameLink key="proj" projectId={p.project_id} name={projectDisplayName(p.project)} legalName={p.project.name} /> : null,
    p.vendor?.name ? <CompanyNameLink key="supplier" companyId={p.vendor_id} name={p.vendor.name} /> : <span key="supplier-missing">{t('procurementRecord:status.supplierNotChosen', 'Supplier not chosen yet')}</span>,
    p.requested_by?.full_name ? <span key="req" className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="grid size-6 place-items-center rounded-full bg-secondary text-[12px] font-semibold text-secondary-foreground">{p.requested_by.full_name.trim().slice(0, 1).toUpperCase()}</span><span>{t('procurementRecord:meta.raisedBy', 'Raised by')} {p.requested_by.full_name}</span></span> : null,
  ].filter((part): part is React.ReactElement => part !== null)
    .map((part, i) => <span key={String(part.key)}>{i > 0 && ' · '}{part}</span>);

  const detailRows = procurementDetailRows(p, t, linkedDocs.length);

  // Counts are derived from the loaded records; SharePoint references stay out.
  const ledgerRows = buildLedgerRows(p);
  const documentsCount = ledgerRows.length + linkedDocs.length + p.statusEvents.length;
  const attachTargets = procurementAttachTargets(ledgerRows, linkedDocs, t);
  const procTabs = procurementTabs(p, t, documentsCount, ledgerRows);
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
            : captureKind === 'vendor_invoice'
              ? (p.is_subcontract && p.purchase_orders[0]?.id
                ? mutations.captureSubcontractVendorInvoice.isPending
                : mutations.createInvoice.isPending)
              : false;
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
    // #1607: an ERP-owned purchase places its order through the Purchase Order capture (which dispatches to the ERP), never the PMO-only transition.
    if (mainAction.to === 'Ordered' && ownership.mode === 'external' && !p.pre_cutover) {
      setCaptureKind('purchase_order');
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
        statusBelowMetaOnMobile
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
          {waitingNote && <span className="min-w-0 text-[12px] text-muted-foreground">{waitingNote}</span>}
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
      {isDraft && isRequester && <p data-testid="sod-pre-announce" className="mb-3 text-[12.5px] text-muted-foreground">{t('procurementRecord:sod.preAnnounce', "Submitting hands this to another approver. You can't approve your own procurement case.")}</p>}
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

      {/* #1505 P8: what Odoo has not settled for this case, on every tab (renders nothing otherwise). */}
      <OdooCaseStatus procurementId={p.id} />

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

        {tab === 'items' && <ProcurementItemsTab p={p} ownership={ownership} ownershipReady={ownershipReady} casePushInFlight={casePushInFlight} canEditItems={canEditItems} canEditItemValues={canEditItemValues} itemEligibility={itemEligibility} erpItems={erpItems} crud={crud} onMutationError={onMutationError} currentUserId={currentUserId} managerId={managerId} />}

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
              onRecordWithholdingSlip={withholding.openRecord}
              onViewWithholdingSlip={(slipId) => setBupotSelection(slipId)}
              onWithholdingHistory={withholding.openHistory}
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
                  disabled={!vendorReferencesReady}
                  placeholder={t('bupot.selectVendor', 'Select a supplier…')}
                />
                {!vendorReferencesReady && <div role="status">{vendorQuery.isPending ? t('procurementCreate:references.loadingSuppliers', 'Loading suppliers…') : <>{t('procurementCreate:references.suppliersError', "Couldn't load suppliers.")} <Button type="button" variant="outline" onClick={() => void vendorQuery.refetch()}>{t('procurementCreate:references.retrySuppliers', 'Retry suppliers')}</Button></>}</div>}
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!vendorReferencesReady || !selectedVendorId || crud.updateVendor.isPending}
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
            {!isEngineer && <AttachedJournalLines procurementId={p.id} projectId={p.project_id} />}
            <ProcurementMicrosoftReferences procurementId={p.id} requestNumber={p.pr_number} createdAt={p.created_at} targets={attachTargets} />
          </Card>
        )}

        {/* ░░ Vendor quotes tab — Slice 3: VendorQuotesTab (bid comparison).
            Refactors QuotationsSection into a side-by-side comparison layout:
            Vendor / Amount / Valid until · selected row highlighted + won pill.
            Reuses the existing selectQuote RPC + SoD/role gating unchanged. ░░ */}
        {/* #878: PR/RFQ/PO/payment are filed under their PROCUREMENT (0277), so the document
            children roll up here — the project reaches them on read through this procurement. */}

        {tab === 'quotes' && <ProcurementQuotesTab p={p} selectedQuote={selectedQuote} vendorMap={vendorMap} mutations={mutations} crud={crud} canAddQuote={canAddQuote} canSelectQuote={canSelectQuote} canManageFiles={canManageFiles} currentUserId={currentUserId} onMutationError={onMutationError} />}
        {tab === 'details' && <ProcurementDetailsTab rows={detailRows} canEditHeader={canEditHeader} onEdit={() => setHeaderEditOpen(true)} />}
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
          items={p.items}
          currency={p.currency}
          subcontractPoId={p.is_subcontract ? p.purchase_orders[0]?.id : undefined}
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

      {withholding.recordInvoice && p.vendor_id && <VendorWithholdingSlipRecordForm
        invoice={withholding.recordInvoice} vendorId={p.vendor_id} vendorName={vendorMap[p.vendor_id]} onClose={withholding.closeRecord}
      />}
      {withholding.historyInvoiceId && <VendorWithholdingSlipHistory invoiceId={withholding.historyInvoiceId} onClose={withholding.closeHistory} onView={(id) => { withholding.dismissHistory(); setBupotSelection(id); }} />}
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
          pendingConfirm?.kind === 'transition' && pendingConfirm.to === 'Rejected'
            ? (
              <div className="space-y-3">
                <p>{pendingConfirm.description}</p>
                <TextArea
                  id="procurement-rejection-comment"
                  label={t('procurement:approvalRow.rejectionComment', 'Rejection comment')}
                  value={rejectionComment}
                  onChange={setRejectionComment}
                  required
                  maxLength={1000}
                  helper={t('procurement:approvalRow.rejectionCommentHelp', 'Add a comment for the requester before rejecting this purchase.')}
                />
              </div>
            )
            : pendingConfirm?.kind === 'transition'
            ? pendingConfirm.description
            : pendingConfirm?.kind === 'createGR'
              ? t(
                  'procurementDetail.confirm.grBody',
                  'This records a {{status}} goods receipt against procurement case {{request}}.',
                  { status: pendingConfirm.status.toLowerCase(), request: p.title },
                )
              : t(
                  'procurementDetail.confirm.viBody',
                  'This records a supplier invoice against procurement case {{request}}.',
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
        confirmDisabled={pendingConfirm?.kind === 'transition' && pendingConfirm.to === 'Rejected' && rejectionComment.trim().length === 0}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => void commitConfirm()}
      />

    </div>
  );
};

export default ProcurementDetails;
