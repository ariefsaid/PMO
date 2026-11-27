import { useMaySeePrices } from '@/src/hooks/useHidePrices';
import { useStockItems } from '@/src/hooks/useStock';
import { usePurchaseCaseRead } from '@/src/hooks/usePurchaseCaseRead';
import { FollowUpTaskButton } from '@/src/components/tasks/FollowUpTaskButton';
import { SupplierRiskNote } from '@/src/components/SupplyRiskWarning';
import { useMayOrderPurchases } from '@/src/hooks/useOrderJobRoles';
import { useProjectWorkOrders } from '@/src/hooks/useWorkOrders';
import { Avatar } from '@/src/components/ui/Avatar';
import { useDomainOwnershipMode } from '@/src/hooks/useDomainOwnershipMode';
import { useProcurementItemEligibility } from '@/src/hooks/useProcurementItemEligibility';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  RecordHeader,
  RecordSection,
  RecordStack,
  Button,
  Combobox,
  FigureScope,
  ListState,
  ConfirmDialog,
  ReasonDialog,
  Tabs,
  tabId,
  tabPanelId,
  useToast,
  useIsNarrow,
  ProjectNameLink,
  CompanyNameLink,
  Icon,
  RecordMenu,
  MobileActionBar,
  type RecordMenuItem,
} from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { useProcurementDetail, useProcurementMutations } from '@/src/hooks/useProcurementDetail';
import { useProcurementCrudMutations } from '@/src/hooks/useProcurementCrud';
import { useProcurementRecordMutations } from '@/src/hooks/useProcurementRecords';
import { useErpOrphans } from '@/src/hooks/useErpPurchases';
import { useErpItemOptions } from '@/src/hooks/useErpItemOptions';
import { useVendorOptions } from '@/src/hooks/useFkOptions';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import RentalCheckHistory from './equipment/RentalCheckHistory';
import RentalPanel from '@/src/components/procurement/RentalPanel';
import { mayDecideRoutedApproval, approvalRouteNote } from '@/src/lib/procurement/approvalRoute';
import { waitingForText } from '@/src/lib/approvals/waitingFor';
import { useOperationalWaitingRoute, operationalWaitingForText } from '@/src/hooks/useOperationalWaitingRoute';
import { useRoleOptions } from '@/src/hooks/useRoleOptions';
import { withTabSwitchNavState } from '@/src/lib/tabSwitchNav';
import { useAuth } from '@/src/auth/useAuth';
import { ProcurementDetailsTab, ProcurementItemsTab, ProcurementQuotesTab } from './procurement/ProcurementDetailTabs';
import { LinePlanPanel } from './procurement/LinePlanPanel';
import { OrderReceivingProgress } from './stock/OrderReceivingProgress';
import { procurementAttachTargets, procurementDetailRows, procurementTabs, tabFromParam, type ProcTab } from './procurement/procurementDetailView';
import { useProcurementDecision } from './procurement/useProcurementDecision';
import { PaymentCeilingNotice } from './procurement/PaymentCeilingNotice';
import { ProcurementHeaderEdit } from './procurement/ProcurementHeaderEdit';
import { ProcurementLedger } from './procurement/ProcurementLedger';
import { OdooCaseStatus } from './procurement/OdooCaseStatus';
import { useProcurementGates } from '@/src/hooks/useProcurementGates';
import { usePurchaseOrderSettings } from '@/src/hooks/usePurchaseOrderSettings';
import { itemsNetTotal } from '@/src/lib/itemsNet';
import { purchaseHasValue } from '@/src/lib/procurement/purchaseValue';
import { formatCurrency } from '@/src/lib/format';
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
import { useAgentContextPublisher } from '@/src/lib/agent/context/useAgentContext';
import { useListReturn } from '@/src/hooks/useListReturn';
import { useUnsavedChangesGuard } from '@/src/hooks/useUnsavedChangesGuard';
import { RecordHistory } from '@/src/components/history/RecordHistory';
import { RecordCaptureForm, type CreateRecordInput, type RecordKind } from './procurement/RecordCaptureForm';
import { LinkErpDocumentsDialog } from './procurement/LinkErpDocumentsDialog';
import { DecisionSupportPanel } from '@/src/components/procurement/DecisionSupportPanel';
import { PANEL_VISIBLE_STATUSES } from '@/src/lib/procurement/computeBudgetSignal';
import { ProcurementBudgetSignal, ProcurementStageTracker, ProcurementMoneySummary, ProcurementTimeline } from './procurement/detail/ProcurementDetailPanels';
import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';
import { selectedQuotation } from '../components/procurement';
import { PaymentChannelSection } from './procurement/PaymentChannelSection';
import { ProcurementStatusPill } from '@/src/components/procurement/ProcurementStatusPill';
import { stageForStatus } from '@/src/lib/procurement/stage';
import {
  allowedActions,
  canApproveReject,
  canRecordBillAtStatus,
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


type TimelineWithOrdersProps = React.ComponentProps<typeof ProcurementTimeline>;
const TimelineWithOrders: React.FC<TimelineWithOrdersProps> = (props) => {
  const p = props.procurement;
  const records = [...(p.purchase_requests ?? []), ...(p.purchase_orders ?? []), ...(p.receipts ?? []), ...(p.invoices ?? [])];
  const hasAttribution = records.some((record) => Boolean(record.work_order_id));
  return hasAttribution && p.project_id ? <TimelineWithReadableOrders {...props} records={records} projectId={p.project_id} /> : <ProcurementTimeline {...props} />;
};
const TimelineWithReadableOrders: React.FC<TimelineWithOrdersProps & { records: Array<{ id: string; work_order_id: string | null }>; projectId: string }> = ({ records, projectId, ...props }) => {
  const orders = useProjectWorkOrders(projectId);
  const ordersById = new Map((orders.data ?? []).map((order) => [order.id, order]));
  const workOrderLinks: Record<string, { id: string; label: string }> = {};
  for (const record of records) {
    const order = record.work_order_id ? ordersById.get(record.work_order_id) : undefined;
    if (order) workOrderLinks[record.id] = { id: order.id, label: order.wo_number ?? order.title };
  }
  return <ProcurementTimeline {...props} workOrderLinks={workOrderLinks} />;
};

const ProcurementDetails: React.FC = () => {
  const { t } = useTranslation(['common', 'waitingList', 'walkMoney', 'procurement']);
  const { procurementId, tab: tabParam } = useParams<{ procurementId: string; tab?: string }>();
  // Active tab from the URL :tab param (deep-linkable, role-invariant default Overview).
  const tab = tabFromParam(tabParam);
  // ADR-0016: write affordances gate on the REAL JWT role (not the impersonated
  // effectiveRole) so the buttons shown match what the RPC will actually honor.
  const { realRole, effectiveRole } = useEffectiveRole();
  const may = usePermission();
  const mayReadAllCases = usePurchaseCaseRead();
  // roles-that-decide FR-RTD-009: the database gate says whether this person orders by built-in role (view-as never widens it).
  const mayOrderByRole = useMayOrderPurchases() && realRole === effectiveRole;
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
  // An Ordered purchase is ASSIGNED to the people 1560 puts on the receipt list (an Admin, the actual requester while
  // their role may record a receipt, and this project's own PM) — not every Finance/Executive, not another project's
  // PM, and no light account (the receipt gate refuses a light caller). Only fetched while Ordered.
  const receiptWaiting = useOperationalWaitingRoute('delivery_record', procurementId, detailQuery.data?.status === 'Ordered');
  const { label: roleLabel } = useRoleOptions();
  const linkedErpQuery = useLinkedErpDocuments(procurementId);
  const linkedDocs = linkedErpQuery.data ?? [];
  const gates = useProcurementGates().data;
  const poSettingsQuery = usePurchaseOrderSettings();
  const mutations = useProcurementMutations(procurementId ?? '');
  const crud = useProcurementCrudMutations(procurementId ?? '');
  const recordMutations = useProcurementRecordMutations(procurementId ?? '');
  const erpItems = useErpItemOptions('purchase');
  const stockItems = useStockItems(true);
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
  const maySeePrices = useMaySeePrices();
  const vendorQuery = useVendorOptions();
  const { data: vendorOptions } = vendorQuery;
  const vendorReferencesReady = !vendorQuery.isPending && !vendorQuery.isError && vendorOptions !== undefined;
  const vendorMap: Record<string, string> = React.useMemo(
    () => Object.fromEntries((vendorOptions ?? []).map((o) => [o.value, o.label])),
    [vendorOptions],
  );

  const [mutationError, setMutationError] = useState<string | null>(null);
  const [captureDirty, setCaptureDirty] = useState(false);
  const [pendingCaptureLeave, setPendingCaptureLeave] = useState<(() => void) | null>(null);
  const [notesInput, setNotesInput] = useState('');
  const [showCreateGR, setShowCreateGR] = useState(false);
  const [showCreateVI, setShowCreateVI] = useState(false);
  const [captureKind, setCaptureKind] = useState<RecordKind | null>(null);
  const [autoOpenFirstDocument, setAutoOpenFirstDocument] = useState<RecordKind | null>(null);
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
  useEffect(() => {
    if (captureKind === null && !showCreateGR && !showCreateVI && !showVICapture) setCaptureDirty(false);
  }, [captureKind, showCreateGR, showCreateVI, showVICapture]);
  const erpOrphanQuery = useErpOrphans(undefined, { enabled: linkDialogOpen });

  // FR-AXP-021 (Track C): publish the loaded record to the live agent context so a
  // follow-up like "summarize this" grounds to the viewed procurement case —
  // grounding only (NFR-AXP-SEC-003), never an authorization signal. Placed before
  // any early return (Rules of Hooks) — cleared on unmount/navigate.
  // Reads `detailQuery.data` directly (not a pre-aliased local) so the later reads of
  // `detailQuery.data` (after the loading/no-access/error guards below) keep their
  // discriminated-union narrowing — an early `const data = detailQuery.data` alias
  // would break CFA at the point of use further down (strict-mode TS2339/TS2322).
  const { setEntity } = useAgentContextPublisher();
  useLayoutEffect(() => {
    if (!detailQuery.data) return;
    if (realRole === 'Engineer' && detailQuery.data.requested_by_id !== currentUser?.id) return;
    if (realRole === 'Project Manager' && detailQuery.data.project?.project_manager_id !== currentUser?.id) return;
    setEntity({ type: 'procurement_case', id: detailQuery.data.id, label: detailQuery.data.title });
    return () => setEntity(undefined);
  }, [detailQuery.data, setEntity, realRole, currentUser?.id]);

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
  const guardCaptureLeave = useUnsavedChangesGuard({
    dirty: captureDirty,
    guardHistory: true,
    onBlocked: (leave) => setPendingCaptureLeave(() => leave),
  });
  const closeCapture = () => {
    setCaptureDirty(false);
    setCaptureKind(null);
  };
  const goBack = () => guardCaptureLeave(() => returnToList('procurement'));

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
  const { pendingConfirm, setPendingConfirm, onActionClick, commitConfirm, submitVICapture, confirmInFlight } =
    useProcurementDecision(detailQuery.data, mutations, {
      setTab, notesInput, setNotesInput, setMutationError, setShowCreateGR, setShowCreateVI, setShowVICapture, setCaptureKind,
      openSupplierPicker: () => { setTab('files'); setSelectedVendorId(null); setVendorPickerOpen(true); },
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
  // The record's own project embed carries the manager (#2107): no second read, so no pending state to wait on.
  const managerId = p.project?.project_manager_id;
  // The requester always sees their own procurement, whatever project (or none) it sits on.
  const raisedByMe = !!currentUser?.id && p.requested_by_id === currentUser.id;
  // A person the database lets order purchases (actor_may_order_purchases, the same gate the record read uses) opens any purchase
  // of the organisation; money stays behind the access-level views below.
  const namedApprover = p.status === 'Requested' && Boolean(currentUser?.id && p.approvalRoute?.approvers.some((a) => a.id === currentUser.id));
  const ordinaryRecordScope = namedApprover || mayOrderByRole || (role === 'Engineer'
    ? raisedByMe
    : role === 'Project Manager'
      ? raisedByMe || Boolean(p.project_id && p.project != null && managerId === currentUser?.id)
      : true);
  // A recorded decision remains readable after routing stops attaching Requested-only approvers.
  const decidedByMe = Boolean(currentUser?.id && (p.approved_by_id === currentUser.id
    || p.statusEvents.some((event) => event.actor_id === currentUser.id && event.from_status === 'Requested' && ['Approved', 'Rejected'].includes(event.to_status))));
  const readOnlyDecision = decidedByMe && !ordinaryRecordScope;
  const recordInScope = ordinaryRecordScope || decidedByMe;
  const inspectionOnly = mayReadAllCases && !recordInScope;
  if (!recordInScope && !inspectionOnly) {
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
      ? approvalRouteNote(p.approvalRoute, p.budget_category, t)
      : null;
  const hasValue = purchaseHasValue(p);
  const actions = readOnlyDecision ? [] : sortActions(allowedActions(p.status, role, isRequester, isApprover, t, routeAllows, (p.payments?.length ?? 0) > 0, hasValue, mayOrderByRole, p.planPurchaseContext));
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
      // A route with no named approver says nothing rather than "Goes to" with an empty name.
      : p.approvalRoute.approvers.length > 0
        ? t('procurementRecord:approval.goesTo', 'Goes to {{name}}', { name: p.approvalRoute.approvers.map((approver) => approver.fullName).join(' or ') })
        : null
    : null;
  // #2695: the approver sees how much of the budget line is already used. Text, not colour; absent when the figures are
  // not readable (below approval rank, unknown spending), so it never states a number the server did not give.
  const budgetUsedLine = p.status === 'Requested' && !isRequester && routeAllows
    && p.approvalRoute && p.approvalRoute.lineBudget != null && p.approvalRoute.lineUsed != null
    ? t('procurementRecord:approval.budgetUsed', 'Budget line used {{used}} of {{budget}}', {
        used: formatCurrency(p.approvalRoute.lineUsed, p.currency),
        budget: formatCurrency(p.approvalRoute.lineBudget, p.currency),
      })
    : null;
  // fix-waiting item 3: who the request waits for, from the route the database already computed (never a bare "Waiting for approval").
  const requestedRoute = p.approvalRoute;
  // An Ordered purchase is assigned to the actual people the database's receipt list names (the requester while their
  // role allows it, this project's own manager, an Admin) — not every Finance/Executive. The viewer who can record it
  // already has that action, so the line is for everyone else. Pending says nothing; a failed read offers a retry.
  const canReceiveHere = isRequester || RECEIPT_ROLES.has(role);
  const receiptWaitingNote = p.status === 'Ordered' && !canReceiveHere
    ? receiptWaiting.isError
      ? <button type="button" onClick={() => void receiptWaiting.refetch()} className="font-medium text-primary-text hover:underline">
          {t('ui.listState.retry', 'Retry')}
        </button>
      : operationalWaitingForText(receiptWaiting.data, t, { roleLabel, empty: 'none' })
    : null;
  const waitingNote = p.status === 'Requested' && isRequester
    ? waitingForText({
        names: (requestedRoute?.approvers ?? []).map((approver) => approver.fullName),
        role: requestedRoute?.route === 'admin' ? t('waitingList:waitingFor.roleAdmin', 'Admin')
          : requestedRoute?.route === 'org' ? t('waitingList:waitingFor.roleOrg', 'senior approver')
          : requestedRoute?.route === 'project' ? t('waitingList:waitingFor.roleProject', 'project approver')
          : t('waitingList:waitingFor.roleFlat', 'project manager or Finance'),
      }, t)
    : p.status === 'Ordered'
      ? receiptWaitingNote
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
    !readOnlyDecision && ((isDraft || isRejected) && (isRequester || realRole === 'Admin') && may('edit', 'procurement'));
  // #2698: the payment channel (shown only where the org switched it on). Requester or Admin while Draft/Rejected (the header
  // rule), or Finance/Admin until Paid or Cancelled. UX only: set_procurement_payment_channel (1356) is the authority.
  const canSetPaymentChannel = !readOnlyDecision && (may('setPaymentChannel', 'procurement', {
    record: { status: p.status, requested_by_id: p.requested_by_id, viewOnly: realRole !== effectiveRole },
    currentUserId: currentUser?.id,
  }));
  // Line items: requester OR PM/Finance/Admin while Draft (matches the 0015 RLS).
  const ownershipReady = ownership.mode === 'pmo' || ownership.mode === 'external';
  const canEditLineAttribution = !readOnlyDecision && (isRequester || may('edit', 'procItem'));
  const canEditItems = !readOnlyDecision && (ownershipReady && isDraft && (isRequester || may('edit', 'procItem')));
  const casePushInFlight = ownership.mode === 'external' && (
    mutations.pendingPush?.status === 'pushing' || recordMutations.pendingPush?.status === 'pushing'
    || mutations.createQuotation.isPending || mutations.createReceipt.isPending || mutations.createInvoice.isPending
    || recordMutations.createPurchaseRequest.isPending || recordMutations.createRfq.isPending
    || recordMutations.createPurchaseOrder.isPending || recordMutations.createPayment.isPending
  );
  const canEditItemValues = ownership.mode === 'pmo' || (ownership.mode === 'external' && !casePushInFlight && itemEligibility.data === true && !itemEligibility.isError && !itemEligibility.isFetching);
  // Quotations: sourcing roles add; select offered only while Vendor Quoted.
  // A person who orders purchases (roles-that-decide) also adds and selects quotes (create_procurement_quotation / select_procurement_quote).
  const canAddQuote = !readOnlyDecision && (may('create', 'quotation') || mayOrderByRole);
  const canSelectQuote = canAddQuote && p.status === 'Vendor Quoted';
  // Phase-file attachments (ADR-0023): same writer set as procDoc; RLS is the authority.
  const canManageFiles = !readOnlyDecision && (may('create', 'procFile'));
  // DD-EFK-1: separate Admin/Finance UX gate; the PMO setter RPC is the enforcement authority.
  const canRecordEfaktur = !readOnlyDecision && (may('record_efaktur', 'procurementInvoice'));
  // #1671: voiding a mistyped subcontract bill is offered only while PMO owns procurement (no ERP); the
  // void_subcontract_bill RPC is the authority for role, author separation and the ERP boundary.
  // Hidden while the organisation has an active external binding (or that is not yet known): the server always refuses there.
  const canVoidBill = !readOnlyDecision && (ownership.mode === 'pmo' && ownership.orgBound === false && may('void', 'procurementInvoice'));
  const canWriteWithholdingSlip = !readOnlyDecision && (may('create', 'vendorWithholdingSlip', { record: { viewOnly: effectiveRole !== realRole } }));
  // 0002_rls.sql defines procurements_update for Admin, Executive, Project Manager, and Finance;
  // 0010_procurement_rls_hardening.sql preserves that row policy while narrowing writable columns.
  const canSetVendorAsManager = !readOnlyDecision && (!p.vendor_id
    && effectiveRole === realRole
    && realRole != null
    && ['Admin', 'Executive', 'Project Manager', 'Finance'].includes(realRole)
    && may('edit', 'procurement'));
  // A person who orders purchases names the supplier of an approved purchase (set_procurement_supplier); amounts stay closed.
  const canSetVendorAsBuyer = !canSetVendorAsManager && !p.vendor_id && mayOrderByRole && p.status === 'Approved';
  const canSetVendor = canSetVendorAsManager || canSetVendorAsBuyer;
  const canLinkAccounting = !readOnlyDecision && (role === 'Admin' || role === 'Finance');
  const currentUserId = currentUser?.id ?? null;


  // Shared classified-toast helper for the CRUD section mutations.
  const onMutationError = (err: unknown) => {
    const { headline, detail } = classifyMutationError(err);
    toast(headline, detail, 'warning');
  };
  // 0349: where payment is blocked because the billed amount exceeds the approved amount, an eligible
  // approver (the Approve role set, never the requester) may approve the higher amount. UX only — the
  // server decides eligibility from the approval route and refuses the quote selector / bill recorder.
  const canApproveAmount = !readOnlyDecision && canApproveReject(role) && !isRequester && !p.planPurchaseContext?.isSubmitter;
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
    && (p.status === 'Draft' || canRecordBillAtStatus(p.status))
    && ((p.payments?.length ?? 0) > 0 || p.status === 'Vendor Invoiced');
  const gateMsg = sodGateMessage(p, role, isRequester, t)
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
    ? t('procurementRecord:sod.approverHint', 'You may approve or return this procurement. The requester cannot approve their own.')
    : payerSodNote);
  // AC-IXD-PROC-005: a create affordance disappears once its stage has passed.
  // The GR form is offered only while goods are being received (Ordered |
  // Received); the VI form only while the request is at Vendor Invoiced. Neither
  // persists into the terminal Paid state under "No further actions". An already-
  // created GR/VI stays legible (read-only) via the document trail + stat tiles.
  // AC-AUTHZ: mirror the Ordered→Received transition authority from the RPC — requester OR PM,
  // plus Admin break-glass. Finance and Executive are NOT in the GR-creation role set (0018).
  const canShowGRForm =
    !readOnlyDecision && ((p.status === 'Ordered' || p.status === 'Received') &&
    (isRequester || RECEIPT_ROLES.has(role)));
  // O3 (review): the after-form is now the RECOVERY surface — it shows only when the PR is at
  // Vendor Invoiced but NO invoice record exists yet (e.g. the inline capture's transition
  // succeeded but the invoice-create failed). On the happy path the inline capture already created
  // the VI, so `p.invoices.length > 0` hides this form — no redundant second-create.
  const canShowVIForm =
    !readOnlyDecision && (p.status === 'Vendor Invoiced' && (p.invoices?.length ?? 0) === 0 && INVOICE_PAY_ROLES.has(role));

  // Rule 13 (one-type): the record title is the only heavy text in the header — the sub-line's
  // project and supplier links render regular weight (the meta wrapper forces `[&_a]:font-normal`
  // over the shared name links' own font-medium). From sm up each item is whole and carries its own
  // aria-hidden '·' BEFORE it (never after), so a wrapped line can't end on a dot; below sm items stack.
  const meta = [
    p.code ? <span key="code" className="record-id">{p.code}</span> : null,
    p.project?.name ? <ProjectNameLink key="proj" projectId={p.project_id} name={projectDisplayName(p.project)} legalName={p.project.name} /> : null,
    !maySeePrices ? null : p.vendor?.name ? <CompanyNameLink key="supplier" companyId={p.vendor_id} name={p.vendor.name} /> : <span key="supplier-missing" className="inline-flex items-center gap-1.5">{t('procurementRecord:status.supplierNotChosen', 'Supplier not chosen yet')}
      {canSetVendorAsBuyer && <Button variant="outline" size="sm" data-testid="buyer-set-supplier" onClick={() => { setTab('files'); setSelectedVendorId(null); setVendorPickerOpen(true); }}>{t('bupot.setVendor', 'Set supplier')}</Button>}</span>,
    p.requested_by?.full_name ? <span key="req" className="inline-flex items-center gap-1.5"><Avatar name={p.requested_by.full_name} decorative /><span>{t('procurementRecord:meta.raisedBy', 'Raised by')} {p.requested_by.full_name}</span></span> : null,
  ].filter((part): part is React.ReactElement => part !== null);

  const detailRows = procurementDetailRows(p, t, linkedDocs.length);

  // Counts are derived from the loaded records; SharePoint references stay out.
  const ledgerRows = buildLedgerRows(p);
  const visibleLinkedDocsCount = isEngineer
    ? linkedDocs.filter((doc) => doc.doctype !== 'Purchase Invoice' && doc.doctype !== 'Payment Entry').length
    : linkedDocs.length;
  const documentsCount = 1 + ledgerRows.length + visibleLinkedDocsCount + p.statusEvents.length;
  const attachTargets = procurementAttachTargets(ledgerRows, linkedDocs, t);
  const procTabs = procurementTabs(p, t, documentsCount, ledgerRows);
  // AC-IXD-PROC-005: a closed procurement (Paid, Cancelled, Rejected) takes no new documents — same rule as the Files-tab capture row.
  const isClosed = p.status === 'Paid' || p.status === 'Cancelled' || p.status === 'Rejected';
  const recordKinds = isClosed || readOnlyDecision ? [] : recordableFirstKinds({
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
  const openQuotationCapture = () => {
    if (tabParam === 'quotes') {
      document.querySelector<HTMLButtonElement>('[data-testid="add-quotation"]')?.click();
      return;
    }
    quoteAutoOpen.current = true;
    setTab('quotes');
  };
  const exportCurrentProcurement = () => {
    const csv = [maySeePrices ? 'number,title,status,project,supplier' : 'number,title,status,project', [p.code ?? '', p.title, p.status, p.project?.name ?? '', ...(maySeePrices ? [p.vendor?.name ?? ''] : [])].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')].join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `${p.code ?? 'procurement'}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const poPrintEnabled = poSettingsQuery.data?.enabled ?? false;
  const primaryPo = p.purchase_orders?.[0];

  // Menu data for the record header and the phone action bar. `narrowOnly` rows repeat verbs the
  // desktop header already shows elsewhere (the Record another document menu).
  const recordMenuItems: RecordMenuItem[] = [
    ...recordKinds.map((kind) => ({ key: `record-${kind}`, label: recordKindLabels[kind], onSelect: () => beginCapture(kind) })),
    ...(canAddQuote && p.status === 'Vendor Quoted' ? [{ key: 'add-quote', label: t('procurementRecord:action.addQuote', 'Add quotation'), onSelect: openQuotationCapture }] : []),
    ...(canLinkAccounting ? [{ key: 'link-accounting', label: t('procurementRecord:linkAccounting', 'Link from accounting system'), onSelect: () => setLinkDialogOpen(true) }] : []),
  ];
  const cancelAction = actionFor('Cancelled');
  const moreMenuItems: RecordMenuItem[] = [
    ...(isNarrow ? recordMenuItems : []),
    ...(canEditHeader ? [{ key: 'edit-header', testId: 'edit-header', label: t('procurementRecord:editDetails', 'Edit details'), onSelect: () => setHeaderEditOpen(true) }] : []),
    ...(poPrintEnabled && primaryPo ? [{ key: 'print-po', testId: 'print-purchase-order', label: t('procurement:purchaseOrderPrint.printAction', 'Print purchase order'), onSelect: () => navigate(`/procurement/${p.id}/purchase-orders/${primaryPo.id}/print`) }] : []),
    { key: 'history', label: t('procurementRecord:timeline.fullHistory', 'Full history'), onSelect: () => { setHistoryOpen(true); setTab('timeline'); } },
    ...secondaryTransitionActions.map((action) => ({ key: `to-${action.to}`, label: action.label, onSelect: () => onActionClick(action) })),
    { key: 'export', label: t('procurementRecord:export', 'Export'), onSelect: exportCurrentProcurement },
    ...(returnAction ? [{ key: 'reject', label: t('procurementRecord:action.return', 'Return'), onSelect: () => onActionClick(returnAction), danger: true }] : []),
    ...(cancelAction ? [{ key: 'cancel', label: t('procurementRecord:cancelProcurement', 'Cancel procurement'), onSelect: () => onActionClick(cancelAction), danger: true }] : []),
  ];

  // Header notes: each speaks about an action in the header (the error of the last step, who it waits on, the approver's
  // limit, separation of duties, what gates Submit, the payment ceiling, the optional approval note). One line each.
  // The approver's decision: the limit and separation-of-duties facts read as one line, then the optional note.
  const decidesHere = mainAction?.to === 'Approved';
  const decisionLine = [approverLimitLine, budgetUsedLine, decisionContextNote].filter(Boolean);
  const approvalNote = mainAction?.to === 'Approved' && <label key="approval-note" className="block max-w-xl text-control font-medium text-foreground">{t('procurementRecord:approval.note', 'Approval note (optional)')}
    <textarea data-testid="procurement-notes-input" value={notesInput} onChange={(event) => setNotesInput(event.target.value)} rows={2} className="mt-1 block w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" />
  </label>;
  const headerNotes = [
    mutationError && <p key="error" role="alert" data-testid="procurement-mutation-error" className="rounded-md border border-destructive/25 bg-destructive/[0.04] px-3 py-2 text-sm text-destructive-text">{mutationError}</p>,
    waitingNote && <p key="waiting" data-testid="procurement-waiting" className="text-control text-muted-foreground">{waitingNote}</p>,
    !decidesHere && approverLimitLine && <p key="limit" className="font-medium">{approverLimitLine}</p>,
    !decidesHere && decisionContextNote && <p key="sod" data-testid="sod-ready-hint">{decisionContextNote}</p>,
    isDraft && p.items.length === 0 && mainAction?.to === 'Requested' && <p key="gate" data-testid="line-items-gate">{t('procurementRecord:gate.addLineItem', 'Add at least one line item before submitting.')}</p>,
    isDraft && isRequester && <p key="pre-announce" data-testid="sod-pre-announce">{t('procurementRecord:sod.preAnnounce', "Submitting hands this to another approver. You can't approve your own procurement case.")}</p>,
    routeNote && !(showVICapture || showCreateGR || showCreateVI) && <p key="route" data-testid="approval-route-note">{routeNote}</p>,
    ceilingNotice && <div key="ceiling">{ceilingNotice}</div>,
  ].filter(Boolean);
  // Request stage: the budget evidence for the approval. For the person who decides it is the block that waits on
  // them (tinted, first in the band, with the decision facts and note); for anyone else it follows the stage strip.
  const requestStage = stageForStatus(p.status) === 'Request';
  // The same visibility the panel applies to itself, so the money block leaves the total out only where the panel shows it.
  const showsBudgetImpact = Boolean(p.project_id) && PANEL_VISIBLE_STATUSES.includes(p.status) && may('view', 'procurement');
  const decisionAside = decidesHere ? (
    <div className="flex flex-col gap-4">
      {decisionLine.length > 0 && <p data-testid="sod-ready-hint" className="flex items-start gap-2 text-control text-foreground">
        <Icon name={p.approvalRoute?.reason === 'within_budget' ? 'check' : 'info'} className={`mt-0.5 size-4 shrink-0 ${p.approvalRoute?.reason === 'within_budget' ? 'text-success-text' : 'text-muted-foreground'}`} aria-hidden="true" />
        <span>{decisionLine.map((part, i) => <React.Fragment key={i}>{i > 0 && ' · '}<span>{part}</span></React.Fragment>)}</span>
      </p>}
      {approvalNote}
      {!isNarrow && mainAction && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" onClick={clickMainAction}>{mainAction.label}</Button>
          {returnAction && <Button variant="outline" size="sm" onClick={() => onActionClick(returnAction)}>{returnAction.label}</Button>}
        </div>
      )}
    </div>
  ) : null;
  const budgetImpact = requestStage && p.project_id ? <DecisionSupportPanel
    bare
    aside={decisionAside}
    projectId={p.project_id}
    totalValue={Number(p.total_value)}
    projectName={p.project ? projectDisplayName(p.project) : null}
    projectLegalName={p.project?.name}
    projectStatus={p.project?.status}
    status={p.status}
    currency={p.currency}
  /> : null;

  if (linkedErpQuery.isError) return <ListState variant="error" title={t('procurement:linkedDocuments.error', "Couldn't load linked accounting documents")} onRetry={() => void linkedErpQuery.refetch()} />;
  if (linkedErpQuery.isPending) return <ListState variant="loading" rows={4} />;

  if (inspectionOnly) return <FigureScope><RecordStack>
    <BackBar label={t('procurementDetail.backToProcurement', 'Procurement')} onBack={goBack} />
    <RecordHeader panelInset name={p.title} status={<ProcurementStatusPill status={p.status} />} meta={maySeePrices ? p.vendor?.name : undefined}>
      {p.vendor_id && <SupplierRiskNote supplierId={p.vendor_id} />}
    </RecordHeader>
    <TimelineWithOrders procurement={p} ledgerRows={ledgerRows} linkedDocuments={linkedDocs} isEngineer={isEngineer} canWriteFiles={false} uploadedById={currentUserId} onFullHistory={() => setHistoryOpen((open) => !open)} />
    {historyOpen && <RecordSection title={t('procurementRecord:timeline.fullHistory', 'Full history')}><RecordHistory entityType="procurement" entityId={p.id} includeChildren /></RecordSection>}
  </RecordStack></FigureScope>;

  return (
    <FigureScope>
    {/* The record frame (as on the project record): one header panel holding identity, status, the stage band, money,
        actions and the notes that gate them; the tabs directly under it; every section a panel on the same inset. */}
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
        panelInset
        className="mb-3!"
        icon={null}
        name={p.title}
        statusBelowMetaOnMobile
        status={
          <span data-testid="procurement-status-badge" data-status={p.status}>
            <ProcurementStatusPill status={p.status} />
          </span>
        }
        // Each later item carries its dot before it in a fixed 16px slot; the row is shifted left by one slot inside a
        // clipping wrapper, so the dot that starts a wrapped line falls outside it and no line begins with "·".
        meta={meta.length ? <span className="block overflow-hidden"><span data-testid="record-meta" className="flex flex-col gap-y-1 sm:-ml-4 sm:flex-row sm:flex-wrap sm:items-center [&_a]:font-normal">{meta.map((part, i) => <span key={part.key} className={i === 0 ? 'sm:whitespace-nowrap sm:pl-4' : 'sm:whitespace-nowrap'}>{i > 0 && <span data-meta-dot aria-hidden="true" className="hidden w-4 text-center text-muted-foreground sm:inline-block">·</span>}{part}</span>)}</span></span> : undefined}
        actions={!isNarrow ? <RecordMenu items={recordMenuItems} label={t('procurementRecord:recordAnother', 'Record another document')} ariaLabel={t('procurementRecord:recordMenu', 'Record another document')} /> : undefined}
        // B4: below 640px the phone action bar owns the one filled main action and the menu.
        // When deciding an approval, Approve + Return sit directly under the approval note in the tinted decision band.
        primaryAction={mainAction && !isNarrow && !decidesHere ? (
          <Button variant="primary" size="sm" disabled={mainAction.to === 'Requested' && p.items.length === 0} onClick={clickMainAction}>{mainAction.label}</Button>
        ) : undefined}
        menuItems={mainAction && isNarrow ? undefined : moreMenuItems}
        menuLabel={t('procurementRecord:moreActions', 'More procurement actions')}
        band={
          <div className="flex flex-col gap-4">
            {/* The decision waits on this viewer: a tinted band from edge to edge of the header panel, its content on
                the panel's own inset (the negative margins only undo the band's top padding and the panel inset). */}
            {decidesHere && (
              <div data-testid="procurement-decision" className="-mx-[var(--panel-inset)] -mt-4 border-b border-warning/25 bg-waiting-surface px-[var(--panel-inset)] py-6">
                {showsBudgetImpact ? budgetImpact : decisionAside}
              </div>
            )}
            <ProcurementStageTracker procurement={p} linkedDocuments={linkedDocs} isEngineer={isEngineer} />
            {/* Money carries the record's one "N figures hidden · Why" line, under the figures it reports on. The
                request total is not repeated here while the budget impact above already shows the same amount. */}
            <ProcurementMoneySummary procurement={p} linkedDocuments={linkedDocs} isEngineer={isEngineer} omitRequestedEqualTo={showsBudgetImpact ? Number(p.total_value) : undefined} budgetSignal={isEngineer || (requestStage && p.project_id) ? undefined : <ProcurementBudgetSignal
              projectId={p.project_id}
              totalValue={Number(p.total_value)}
              status={p.status}
              currency={p.currency}
            />} />
            {!decidesHere && budgetImpact && <div className="border-t border-border pt-4 empty:hidden">{budgetImpact}</div>}
            {/* #1505 P8: what Odoo has not settled for this case, on every tab (renders nothing otherwise). */}
            <OdooCaseStatus procurementId={p.id} className="border-t border-border pt-4" />
          </div>
        }
      >
        {/* The notes that speak about the header's actions sit inside the header, under its band. */}
        {headerNotes.length > 0 ? headerNotes : null}
        {p.vendor_id && <SupplierRiskNote supplierId={p.vendor_id} />}
        <div><FollowUpTaskButton type="procurement" recordId={p.id} projectId={p.project_id} defaultName={p.po_number ?? p.pr_number ?? p.title} finished={p.status === 'Paid' || p.status === 'Cancelled'} /></div>
      </RecordHeader>

      {/* The header edit form opens as a panel under the header, before the tabs. */}
      <div className="mb-3 flex flex-col gap-3 empty:hidden [&>*]:mb-0!">
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
      </div>

      {may('transition', 'equipmentAvailability') && <RentalCheckHistory procurementId={p.id} />}
      {/* #2697: type, rental period, extension links and the guided extend step. Mounted only on a typed purchase, so an organisation
          without purchase types renders exactly what it did before. */}
      {p.purchase_type_id && (
        <div className="mb-3">
          <RentalPanel readOnly={readOnlyDecision} procurementId={p.id} title={p.title} status={p.status} purchaseTypeId={p.purchase_type_id}
            rentalFrom={p.rental_from} rentalTo={p.rental_to} extendsId={p.extends_procurement_id}
            lines={(p.items ?? []).map((i) => ({ id: i.id, name: i.name, description: i.description ?? null, quantity: Number(i.quantity), rate: i.rate === null ? null : Number(i.rate) }))} />
        </div>
      )}

      {/* Deep-linkable detail sections, directly under the header (as on the project record). */}
      <Tabs<ProcTab>
        items={procTabs}
        value={tab}
        onChange={setTab}
        ariaLabel={t('procurementDetail.tabsLabel', 'Procurement sections')}
        idBase="procurement-detail"
        insetFirstTab
        className="mb-0!"
      />

      <div
        role="tabpanel"
        id={tabPanelId('procurement-detail', tab)}
        aria-labelledby={tabId('procurement-detail', tab)}
        data-testid={`procurement-tabpanel-${tab}`}
        className="pt-4 md:pt-6"
      >
        {tab === 'timeline' && <RecordStack>
          <TimelineWithOrders focusedRecordId={location.hash.startsWith("#cost-") ? location.hash.slice(6) : undefined} procurement={p} ledgerRows={ledgerRows} linkedDocuments={linkedDocs} isEngineer={isEngineer} canWriteFiles={canManageFiles} uploadedById={currentUserId} onFullHistory={() => setHistoryOpen((open) => !open)} />
          {primaryPo && (
            <RecordSection data-testid="procurement-po-print" title={t('procurement:purchaseOrderPrint.section', 'Purchase order')}>
              {poPrintEnabled
                ? <Button variant="outline" size="sm" data-testid="print-purchase-order-inline" onClick={() => navigate(`/procurement/${p.id}/purchase-orders/${primaryPo.id}/print`)}>{t('procurement:purchaseOrderPrint.printAction', 'Print purchase order')}</Button>
                : <p className="text-control text-muted-foreground" data-testid="po-print-off">{t('procurement:purchaseOrderPrint.off', 'Printing the purchase order is off. An Admin turns it on in Administration, Accounting, Purchase order printing.')}</p>}
            </RecordSection>
          )}
          {historyOpen && <RecordSection data-testid="procurement-full-history" title={t('procurementRecord:timeline.fullHistory', 'Full history')} actions={<Button variant="outline" size="sm" onClick={() => setHistoryOpen(false)}>{t('procurementRecord:close', 'Close')}</Button>}><RecordHistory entityType="procurement" entityId={p.id} includeChildren /></RecordSection>}
        </RecordStack>}

        {tab === 'items' && <RecordStack><ProcurementItemsTab readOnly={readOnlyDecision} p={p} stockItems={(stockItems.data ?? []).map((item) => ({ id: item.id, code: item.code, name: item.name, archived: Boolean(item.archived_at) }))} ownership={ownership} ownershipReady={ownershipReady} casePushInFlight={casePushInFlight} canEditItems={canEditItems} canEditItemValues={canEditItemValues} itemEligibility={itemEligibility} erpItems={erpItems} crud={crud} onMutationError={onMutationError} currentUserId={currentUserId} managerId={managerId} /><OrderReceivingProgress orderId={primaryPo?.id} />
          {/* One table for when and for what each line is needed (category, needed-by, work order), under the money table. */}
          <LinePlanPanel procurementId={p.id} items={p.items} projectId={p.project_id} requestWorkOrderId={p.work_order_id}
            planningEditable={canEditItems && canEditItemValues}
            neededByEditable={canEditLineAttribution && ['Draft', 'Requested', 'Approved', 'Vendor Quoted', 'Quote Selected'].includes(p.status)}
            workOrdersEditable={canEditLineAttribution} /></RecordStack>}

        {/* ░░ Documents tab — Slice 2: ProcurementLedger (the single case ledger).
            All 7 record types, chronological, one row each. Filter chips: All /
            Financial / Has file. Capture affordance at bottom (LedgerCaptureRow).
            ProcurementRecordsSection / DocRow / ProcurementDocumentsSection removed. ░░ */}
        {tab === 'files' && (
          <RecordStack>
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
              canVoidBill={canVoidBill}
              invoices={p.invoices}
              targetInvoiceId={targetInvoiceId ?? undefined}
              canWriteWithholdingSlip={canWriteWithholdingSlip}
              vendorMissing={!p.vendor_id}
              onSetVendor={canSetVendor ? () => { setSelectedVendorId(null); setVendorPickerOpen(true); } : undefined}
              onRecordWithholdingSlip={withholding.openRecord}
              onViewWithholdingSlip={(slipId) => setBupotSelection(slipId)}
              onWithholdingHistory={withholding.openHistory}
              isApprover={isApprover}
              firstDocumentKinds={readOnlyDecision ? [] : recordableFirstKinds({
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
            /> : <TimelineWithOrders focusedRecordId={location.hash.startsWith("#cost-") ? location.hash.slice(6) : undefined} procurement={p} ledgerRows={ledgerRows} linkedDocuments={linkedDocs} isEngineer canWriteFiles={canManageFiles} uploadedById={currentUserId} onFullHistory={() => { setHistoryOpen(true); setTab('timeline'); }} />}
            {vendorPickerOpen && canSetVendor && (
              <div role="dialog" aria-label={t('bupot.setVendor', 'Set supplier')} className="panel-card flex flex-wrap items-end gap-3 p-[var(--panel-inset)]">
                <Combobox
                  label={t('bupot.vendor', 'Supplier')}
                  noun={t('bupot.vendor', 'Supplier').toLowerCase()}
                  value={selectedVendorId}
                  onChange={(value) => setSelectedVendorId(value)}
                  loadOptions={async () => vendorOptions ?? []}
                  disabled={!vendorReferencesReady}
                  placeholder={t('bupot.selectVendor', 'Select a supplier…')}
                  compact
                />
                {!vendorReferencesReady && <div role="status">{vendorQuery.isPending ? t('procurementCreate:references.loadingSuppliers', 'Loading suppliers…') : <>{t('procurementCreate:references.suppliersError', "Couldn't load suppliers.")} <Button type="button" variant="outline" onClick={() => void vendorQuery.refetch()}>{t('procurementCreate:references.retrySuppliers', 'Retry suppliers')}</Button></>}</div>}
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!vendorReferencesReady || !selectedVendorId || crud.updateVendor.isPending}
                  onClick={async () => {
                    if (!selectedVendorId) return;
                    try {
                      await crud.updateVendor.mutateAsync(canSetVendorAsBuyer ? { vendorId: selectedVendorId, byBuyer: true } : selectedVendorId);
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
          </RecordStack>
        )}

        {/* ░░ Vendor quotes tab — Slice 3: VendorQuotesTab (bid comparison).
            Refactors QuotationsSection into a side-by-side comparison layout:
            Vendor / Amount / Valid until · selected row highlighted + won pill.
            Reuses the existing selectQuote RPC + SoD/role gating unchanged. ░░ */}
        {/* #878: PR/RFQ/PO/payment are filed under their PROCUREMENT (0277), so the document
            children roll up here — the project reaches them on read through this procurement. */}

        {tab === 'quotes' && p.status === 'Approved' && <div data-testid="quote-next-step" className="mb-3 space-y-3"><p>{t('walkMoney:quotes.next', 'Request quotations before adding and selecting supplier quotes.')}</p>{actionFor('Vendor Quoted') && <Button variant="outline" onClick={() => onActionClick(actionFor('Vendor Quoted')!)}>{actionFor('Vendor Quoted')!.label}</Button>}</div>}
        {tab === 'quotes' && <ProcurementQuotesTab p={p} selectedQuote={selectedQuote} vendorMap={vendorMap} mutations={mutations} crud={crud} canAddQuote={canAddQuote && p.status === 'Vendor Quoted'} canSelectQuote={canSelectQuote} canManageFiles={canManageFiles} currentUserId={currentUserId} onMutationError={onMutationError} />}
        {tab === 'details' && <ProcurementDetailsTab rows={detailRows} canEditHeader={canEditHeader} onEdit={() => setHeaderEditOpen(true)} extra={<PaymentChannelSection asDetailRow procurementId={p.id} canSet={canSetPaymentChannel} />} />}
      </div>

      {captureKind && <RecordSection className="mt-[var(--space-section)]" data-testid="procurement-record-capture" title={recordKindLabels[captureKind]} actions={<Button variant="outline" size="sm" onClick={() => guardCaptureLeave(closeCapture)}>{t('procurementRecord:close', 'Close')}</Button>}>
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
          onClose={closeCapture}
          onDirtyChange={setCaptureDirty}
        />
      </RecordSection>}

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

      {mainAction && isNarrow && (
        <MobileActionBar className="fixed inset-x-0 bottom-[var(--phone-nav-height)] z-40 border-t border-border bg-card p-3 shadow-[0_-2px_10px_hsl(var(--foreground)/0.06)] sm:hidden">
          <div className="mx-auto flex max-w-3xl gap-2">
            {returnAction && mainAction.to === 'Approved' && (
              <Button variant="outline" className="min-h-11 flex-1" onClick={() => onActionClick(returnAction)}>{returnAction.label}</Button>
            )}
            <Button variant="primary" className="min-h-11 flex-1" disabled={mainAction.to === 'Requested' && p.items.length === 0} onClick={clickMainAction}>{mainAction.label}</Button>
            <RecordMenu items={moreMenuItems} side="top" ariaLabel={t('procurementRecord:moreActions', 'More procurement actions')} triggerClassName="min-h-11" />
          </div>
        </MobileActionBar>
      )}
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
        canWrite={!readOnlyDecision && may('edit', 'vendorWithholdingSlip', { record: { viewOnly: effectiveRole !== realRole } })}
        onClose={() => setBupotSelection(null)}
        suppressArrivalFocus={Boolean(targetInvoiceId)}
        onOpenProcurement={(id, slipId, invoiceId) => {
          const params = new URLSearchParams(location.search);
          params.set('bupot', slipId);
          params.set('bupotBill', invoiceId);
          navigate(`/procurement/${encodeURIComponent(id)}/files?${params.toString()}${location.hash}`);
        }}
      />}

      <ReasonDialog
        open={pendingConfirm?.kind === 'transition' && pendingConfirm.to === 'Rejected'}
        kind="return"
        subject={`${p.code} · ${p.title}`}
        context={pendingConfirm?.kind === 'transition' ? pendingConfirm.description : undefined}
        loading={confirmInFlight}
        error={mutationError}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={(reason) => { void commitConfirm(reason); }}
      />

      {/* P1-P4 — confirm-before-write. One dialog drives every staged mutation;
          forward steps + GR/VI are default-tone, Cancel is destructive. */}
      <ConfirmDialog
        open={pendingConfirm !== null && (pendingConfirm.kind !== 'transition' || pendingConfirm.to !== 'Rejected')}
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
        error={mutationError}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => void commitConfirm()}
      />

      <ConfirmDialog
        open={pendingCaptureLeave !== null}
        title={t('entityForm.discardTitle', 'Discard your changes?')}
        description={t('entityForm.discardBody', 'This form has unsaved changes. Discarding will lose them.')}
        confirmLabel={t('procurement:create.unsaved.leave', 'Leave')}
        cancelLabel={t('procurement:create.unsaved.stay', 'Stay')}
        onConfirm={() => {
          const leave = pendingCaptureLeave;
          setPendingCaptureLeave(null);
          setCaptureDirty(false);
          leave?.();
        }}
        onCancel={() => setPendingCaptureLeave(null)}
      />

    </div>
    </FigureScope>
  );
};

export default ProcurementDetails;
