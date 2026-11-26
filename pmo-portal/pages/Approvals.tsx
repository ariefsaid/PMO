import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AccessDenied, Card, ListState, PageHeader, SelectField, ViewToggle } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useTimesheetsAwaitingApproval, useReopenableApprovedTimesheets } from '@/src/hooks/useTimesheetApproval';
import { useAuth } from '@/src/auth/useAuth';
import { scrollBehavior } from '@/src/lib/motion';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { TimesheetApprovalPreview } from './timesheets/ApprovalsQueue';
import { TimesheetBulkConfirm, TimesheetBulkSelect, TimesheetBulkToolbar, useTimesheetBulkApprove } from './timesheets/TimesheetBulkApprove';
import { ProcurementBulkConfirm, ProcurementBulkSelect, ProcurementBulkToolbar } from './approvals/ProcurementBulkApprove';
import { useProcurementBulkApprove } from './approvals/useProcurementBulkApprove';
import { ExpenseClaimApprovalSection } from './approvals/ExpenseClaimApprovalSection';
import { LeaveApprovalSection } from './approvals/LeaveApprovalSection';
import { MedicalReleaseSection } from './approvals/MedicalReleaseSection';
import { ImprestApprovalSection } from './approvals/ImprestApprovalSection';
import { SalesInvoiceApprovalSection } from './approvals/SalesInvoiceApprovalSection';
import { PushAttentionSection } from './approvals/PushAttentionSection';
import { EmployeeLinkConfirmSection } from './approvals/EmployeeLinkConfirmSection';
import { ReopenableApprovedSection } from './approvals/ReopenableApprovedSection';
import { QueueGroup, type QueueItem } from './approvals/ApprovalQueue';
import { useInvoicesAwaitingViewer } from '@/src/hooks/useInvoicesAwaitingViewer';
import { useWaitingForYou } from '@/src/hooks/useWaitingForYou';
import { useDecisionStanding } from '@/src/hooks/useWaitingDecisions';
import { DATABASE_LISTED_KINDS, WAITING_KINDS, scopeLabelText, type DatabaseListedKind } from '@/src/lib/approvals/waitingKinds';
import { WaitingDecisionSection } from './approvals/WaitingDecisionSection';
import { WorkOrderAcceptanceSection } from './approvals/WorkOrderAcceptanceSection';
import { MaterialRequestApprovalSection } from './approvals/MaterialRequestApprovalSection';
import { ProcurementApprovalPreview } from './approvals/ProcurementApprovalRow';
import { pendingProcurementApprovals, type ApprovalPopulationEntry, type ApprovalScope } from '@/src/lib/selectors/approvals';
import { useExpenseClaimsAwaitingDecision } from '@/src/hooks/useExpenseClaims';
import { claimsAwaitingViewer } from '@/src/lib/expenses/expenseRules';

/** `lg` breakpoint — the two-pane triage activates here. */
const TRIAGE_QUERY = '(min-width: 1024px)';

type Scope = ApprovalScope;

function useIsLargeScreen(): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return true;
    return window.matchMedia(TRIAGE_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(TRIAGE_QUERY);
    setMatches(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return matches;
}

const ApprovalsPage: React.FC = () => {
  const { t } = useTranslation();
  const may = usePermission();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const selfId = currentUser?.id;
  const { realRole } = useEffectiveRole();
  const [searchParams, setSearchParams] = useSearchParams();
  const isLargeScreen = useIsLargeScreen();

  const canApproveProcurement = may('transition', 'procurement');
  const hasTimesheetRole = may('transition', 'approval');
  const canApproveExpenses = ['Admin', 'Executive', 'Finance', 'Project Manager'].includes(realRole ?? '');
  const canApproveInvoices = may('transition', 'salesInvoice');

  const { data: procurements, isPending: procPending, isError: procError, refetch: refetchProc } = useProcurements({ status: 'Requested' });
  const { data: timesheets, isPending: tsPending, isError: tsError, refetch: refetchTimesheets } = useTimesheetsAwaitingApproval();
  const {
    data: correctionSheets,
    isPending: correctionPending,
    isError: correctionError,
    refetch: refetchCorrections,
  } = useReopenableApprovedTimesheets();
  const canApproveTimesheets = hasTimesheetRole || Boolean(timesheets?.length || correctionSheets?.length || tsPending || tsError || correctionPending || correctionError);
  // #784 C-1: the same source the "Customer invoices awaiting you" section lists, so the page never claims "all caught
  // up" above a waiting invoice.
  const invoices = useInvoicesAwaitingViewer();
  const expenseQuery = useExpenseClaimsAwaitingDecision();
  const expenseRows = useMemo(
    () => canApproveExpenses
      ? claimsAwaitingViewer(expenseQuery.data ?? [], selfId, realRole)
      : [],
    [canApproveExpenses, expenseQuery.data, selfId, realRole],
  );

  // #2685: material-request steps awaiting the viewer. Off (the default, and while the setting is unknown) the queue is not
  // requested and nothing below changes.
  // fix-waiting: ONE shared list (the same one the home and the badge read). Every kind a login can decide is in it.
  const waiting = useWaitingForYou();
  const standing = useDecisionStanding();
  const materialCount = waiting.countFor('material');
  const materialPending = waiting.pendingKinds.includes('material');
  const materialError = waiting.failedKinds.includes('material');
  // A failed read on its own never opens the page to someone with nothing to decide; once the page shows, the error is shown with a retry.
  const hasMaterialWork = materialCount > 0 || materialPending;
  const canShowMaterial = hasMaterialWork || (materialError && (canApproveProcurement || canApproveTimesheets || canApproveExpenses || canApproveInvoices));
  // Client acceptances (BAST) are their own kind and their own read (1570), so they get their own scope. Offered when one
  // waits, or while its read is unresolved/failed for someone who could decide it — never invented for a role that cannot.
  const bastCount = waiting.countFor('work_order_acceptance');
  const bastPending = waiting.pendingKinds.includes('work_order_acceptance');
  const bastError = waiting.failedKinds.includes('work_order_acceptance');
  const canShowBast = bastCount > 0 || bastPending || (bastError && (canApproveProcurement || canApproveTimesheets || canApproveExpenses || canApproveInvoices));
  const hasExistingApprovalEligibility = Boolean(
    standing.data ||
    standing.isPending ||
    canApproveProcurement ||
    canApproveTimesheets ||
    canApproveExpenses ||
    canApproveInvoices,
  );
  const extraKinds = (['leave', 'imprest', ...DATABASE_LISTED_KINDS] as const).filter((kind) => {
    if (kind === 'leave') {
      return waiting.countFor('leave') > 0 || (hasExistingApprovalEligibility && (waiting.pendingKinds.includes('leave') || waiting.failedKinds.includes('leave')));
    }
    if (kind === 'imprest') {
      return waiting.countFor('imprest') > 0 || (hasExistingApprovalEligibility && (waiting.pendingKinds.includes('imprest') || waiting.failedKinds.includes('imprest')));
    }
    return waiting.countFor(kind) > 0;
  });
  const databasePending = waiting.pendingKinds.includes('daily_report');
  const databaseError = waiting.failedKinds.includes('daily_report');

  const procurementRows = useMemo(
    () => pendingProcurementApprovals(procurements, selfId, realRole === 'Admin').sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    ),
    [procurements, selfId, realRole],
  );
  const timesheetRows = useMemo(() => tsError ? [] : timesheets ?? [], [timesheets, tsError]);
  const timesheetBulk = useTimesheetBulkApprove(timesheetRows, true);
  const procurementBulk = useProcurementBulkApprove(procurementRows);

  const canShowExpenses = canApproveExpenses && (expenseRows.length > 0 || expenseQuery.isPending || expenseQuery.isError);
  const canShowInvoices = canApproveInvoices && (invoices.rows.length > 0 || invoices.isPending || invoices.isError);
  const availableKinds: Scope[] = [
    ...(canApproveProcurement ? ['procurement' as const] : []),
    ...(canApproveTimesheets ? ['timesheets' as const] : []),
    ...(canApproveExpenses ? ['expense' as const] : []),
    ...(canApproveInvoices && invoices.enabled !== false ? ['invoice' as const] : []),
    ...(canShowMaterial ? ['material' as const] : []),
    ...extraKinds,
    ...(canShowBast ? ['work_order_acceptance' as const] : []),
  ];
  const availableScopes: Scope[] = [
    ...(availableKinds.length > 1 ? (['all'] as const) : []),
    ...availableKinds,
  ];
  const hasTabs = availableScopes.length > 1;
  const urlScope = searchParams.get('scope') as Scope | null;
  const activeScope: Scope =
    urlScope && availableScopes.includes(urlScope)
      ? urlScope
      : availableScopes[0];

  const selectScope = (next: Scope) => {
    const params = new URLSearchParams(searchParams);
    params.set('scope', next);
    setSearchParams(params, { replace: true });
  };

  const pendingProc = canApproveProcurement ? procurementRows.length : 0;
  const pendingTs = canApproveTimesheets ? timesheetRows.length : 0;

  const procSettledEmpty = !canApproveProcurement || (!procPending && !procError && pendingProc === 0);
  const tsSettledEmpty = !tsPending && !tsError && !correctionPending && !correctionError && pendingTs === 0;
  const pendingInv = canShowInvoices ? invoices.rows.length : 0;
  const pendingExpense = canShowExpenses ? expenseRows.length : 0;
  const invSettledEmpty = !invoices.isPending && !invoices.isError && pendingInv === 0;
  const expenseSettledEmpty = !expenseQuery.isPending && !expenseQuery.isError && pendingExpense === 0;
  const allCaughtUp =
    waiting.count === 0 &&
    procSettledEmpty &&
    tsSettledEmpty &&
    invSettledEmpty &&
    expenseSettledEmpty &&
    !canShowMaterial &&
    extraKinds.length === 0 &&
    !canShowBast &&
    !databasePending &&
    !databaseError;
  const allScopePending =
    waiting.count === undefined ||
    (canApproveProcurement && (procPending || procError)) ||
    (canApproveTimesheets && (tsPending || tsError || correctionPending || correctionError)) ||
    (canShowExpenses && (expenseQuery.isPending || expenseQuery.isError)) ||
    (canShowInvoices && (invoices.isPending || invoices.isError)) ||
    (canShowMaterial && (materialPending || materialError)) ||
    (canShowBast && (bastPending || bastError)) ||
    databasePending ||
    databaseError;

  const allPopulation = waiting.entries;
  const countFor = (kind: Scope) => allPopulation.filter((entry: ApprovalPopulationEntry) => entry.kind === kind).length;
  const scopeLabels: Record<Scope, string> = {
    all: t('approvals.scope.all', 'All pending'),
    procurement: t('approvals.scope.procurement', 'Procurement cases'),
    timesheets: t('approvals.scope.timesheets', 'Timesheets'),
    expense: t('approvals.scope.expense', 'Expense claims'),
    invoice: t('approvals.scope.invoice', 'Customer invoices'),
    material: t('materialRequests:inbox.scope', 'Material requests'),
    ...Object.fromEntries(WAITING_KINDS.filter((kind) => !['procurement', 'timesheets', 'expense', 'invoice', 'material'].includes(kind))
      .map((kind) => [kind, scopeLabelText(kind, (key, fallback) => t(key, fallback))])),
  } as Record<Scope, string>;
  // Only name queues this viewer can act on; the empty state must not imply inaccessible work is theirs.
  const caughtUpLabels = availableKinds.map((kind) => scopeLabels[kind].toLowerCase());
  const caughtUpKinds = caughtUpLabels.length === 0
    ? t('approvals.caughtUp.noKinds', 'approvals')
    : caughtUpLabels.length === 1
      ? caughtUpLabels[0]
      : `${caughtUpLabels.slice(0, -1).join(', ')} ${t('approvals.caughtUp.and', 'and')} ${caughtUpLabels[caughtUpLabels.length - 1]}`;

  const queueItems = useMemo<QueueItem[]>(() => {
    const items: QueueItem[] = [];
    if ((activeScope === 'all' || activeScope === 'procurement') && canApproveProcurement) {
      items.push(...procurementRows.map((row) => ({ key: `procurement:${row.id}`, kind: 'procurement' as const, row })));
    }
    if ((activeScope === 'all' || activeScope === 'timesheets') && canApproveTimesheets) {
      items.push(...timesheetRows.map((row) => ({ key: `timesheets:${row.id}`, kind: 'timesheets' as const, row })));
    }
    return items;
  }, [activeScope, canApproveProcurement, canApproveTimesheets, procurementRows, timesheetRows]);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    if (queueItems.length === 0) {
      setSelectedKey(null);
      return;
    }
    if (!selectedKey || !queueItems.some((item) => item.key === selectedKey)) {
      // FN4: below `lg` the preview sits after the whole list, so a pre-picked item's buttons would read as the one
      // the person was looking at. There, nothing is previewed until they pick it.
      setSelectedKey(isLargeScreen ? queueItems[0].key : null);
    }
  }, [queueItems, selectedKey, isLargeScreen]);

  // One grammar at every width: below `lg` the preview stacks under the queue, so bring it into view.
  const pickItem = (key: string) => {
    setSelectedKey(key);
    if (!isLargeScreen) document.getElementById('approvals-preview')?.scrollIntoView?.({ behavior: scrollBehavior(), block: 'start' });
  };
  const selectedItem = queueItems.find((item) => item.key === selectedKey) ?? null;

  if (!canApproveProcurement && !canApproveTimesheets && !canShowInvoices && !canShowMaterial && extraKinds.length === 0 && !canShowBast && !standing.data && !standing.isPending) {
    return (
      <AccessDenied
        title={t('approvals.accessDenied.title', "You don't have access to approvals")}
        sub={t(
          'approvals.accessDenied.sub',
          'Approvals are for the roles that sign off procurement or timesheets. Your work lives on your dashboard, projects, and tasks.',
        )}
        onBack={() => navigate('/')}
      />
    );
  }

  const otherDecisionCount = allPopulation.filter(({ kind }) => kind !== 'procurement' && kind !== 'timesheets').length;
  const showPreview = queueItems.length > 0 || activeScope !== 'all' || otherDecisionCount === 0 || correctionPending || correctionError;

  const previewFallback = (() => {
    if (queueItems.length > 0) return null;
    const includesExpenses = (activeScope === 'all' || activeScope === 'expense') && canShowExpenses;
    const includesInvoices = (activeScope === 'all' || activeScope === 'invoice') && canShowInvoices;
    const includesMaterial = (activeScope === 'all' || activeScope === 'material') && canShowMaterial;
    const includesBast = (activeScope === 'all' || activeScope === 'work_order_acceptance') && canShowBast;
    const includesLeave = (activeScope === 'all' || activeScope === 'leave') && extraKinds.includes('leave');
    const includesImprest = (activeScope === 'all' || activeScope === 'imprest') && extraKinds.includes('imprest');
    const leavePending = waiting.pendingKinds.includes('leave');
    const leaveError = waiting.failedKinds.includes('leave');
    const imprestPending = waiting.pendingKinds.includes('imprest');
    const imprestError = waiting.failedKinds.includes('imprest');
    const currentPending = activeScope === 'procurement' ? procPending
      : activeScope === 'timesheets' ? tsPending || correctionPending
        : activeScope === 'expense' ? expenseQuery.isPending
          : activeScope === 'invoice' ? invoices.isPending
            : activeScope === 'material' ? materialPending
            : activeScope === 'work_order_acceptance' ? bastPending
            : activeScope === 'leave' ? leavePending
            : activeScope === 'imprest' ? imprestPending
            : (canApproveProcurement && procPending) || (canApproveTimesheets && (tsPending || correctionPending)) || (includesExpenses && expenseQuery.isPending) || (includesInvoices && invoices.isPending) || (includesMaterial && materialPending) || (includesBast && bastPending) || (includesLeave && leavePending) || (includesImprest && imprestPending);
    const currentError = activeScope === 'procurement' ? procError
      : activeScope === 'timesheets' ? tsError || correctionError
        : activeScope === 'expense' ? expenseQuery.isError
          : activeScope === 'invoice' ? invoices.isError
            : activeScope === 'material' ? materialError
            : activeScope === 'work_order_acceptance' ? bastError
            : activeScope === 'leave' ? leaveError
            : activeScope === 'imprest' ? imprestError
            : (canApproveProcurement && procError) || (canApproveTimesheets && (tsError || correctionError)) || (includesExpenses && expenseQuery.isError) || (includesInvoices && invoices.isError) || (includesMaterial && materialError) || (includesBast && bastError) || (includesLeave && leaveError) || (includesImprest && imprestError);

    const retryCurrentError = () => {
      if (activeScope === 'procurement') void refetchProc();
      else if (activeScope === 'timesheets') {
        if (tsError) void refetchTimesheets();
        if (correctionError) void refetchCorrections();
      } else if (activeScope === 'expense') void expenseQuery.refetch();
      else if (activeScope === 'invoice') void invoices.refetch();
      else if (activeScope === 'material' || activeScope === 'work_order_acceptance' || activeScope === 'leave' || activeScope === 'imprest') void waiting.refetch();
      else {
        if (canApproveProcurement && procError) void refetchProc();
        if (canApproveTimesheets && tsError) void refetchTimesheets();
        if (canApproveTimesheets && correctionError) void refetchCorrections();
        if (includesExpenses && expenseQuery.isError) void expenseQuery.refetch();
        if (includesInvoices && invoices.isError) void invoices.refetch();
        if (includesMaterial && materialError) void waiting.refetch();
        if (includesBast && bastError) void waiting.refetch();
        if (includesLeave && leaveError) void waiting.refetch();
        if (includesImprest && imprestError) void waiting.refetch();
      }
    };

    if (currentPending) return <ListState variant="loading" rows={4} />;
    if (currentError) {
      return (
        <ListState
          variant="error"
          title={t('approvals.previewError.title', "Couldn't load the selected queue")}
          sub={t(
            'approvals.previewError.sub',
            'Retry from the queue pane to refresh the latest approvals.',
          )}
          onRetry={retryCurrentError}
        />
      );
    }
    return (
      <ListState
        variant="empty"
        icon="inbox"
        title={t('approvals.previewEmpty.title', 'Select an approval item')}
      />
    );
  })();

  return (
    <div>
      <PageHeader title={t('approvals.title', 'Approvals')} />

      {hasTabs && !allCaughtUp && (
        <div className="mb-4 min-w-0">
          {isLargeScreen ? (
            <div
              data-testid="approvals-scope-scroll"
              className="min-w-0 overflow-x-auto scroll-fade-x lg:overflow-visible"
            >
              <ViewToggle<Scope>
                className="max-w-full flex-wrap"
                options={availableScopes.map((scope) => ({
                  value: scope,
                  label: scopeLabels[scope],
                  icon: (scope === 'all' ? 'grid' : scope === 'procurement' ? 'cart' : scope === 'timesheets' ? 'clock' : 'file'),
                  count: allScopePending ? undefined : scope === 'all' ? waiting.count : countFor(scope),
                }))}
                value={activeScope}
                onChange={selectScope}
                ariaLabel={t('approvals.scopeToggleLabel', 'Approvals scope')}
              />
            </div>
          ) : (
            // Phone: every scope is visible in one 44px control instead of a clipped strip.
            <SelectField
              label={t('approvals.scopeToggleLabel', 'Approvals scope')}
              hideLabel
              value={activeScope}
              options={availableScopes.map((scope) => ({ value: scope, label: allScopePending ? scopeLabels[scope] : `${scopeLabels[scope]} · ${scope === 'all' ? waiting.count : countFor(scope)}` }))}
              onChange={(value) => selectScope(value as Scope)}
              fullWidth
              wrapperClassName="w-full"
              className="h-11 w-full text-[16px]"
            />
          )}
        </div>
      )}

      {allCaughtUp ? (
        <div
          className="space-y-2 rounded-lg border border-border bg-card p-4"
          data-testid="approvals-caught-up"
        >
          <div className="text-[16px] font-semibold">
            {t('approvals.caughtUp.title', 'You’re all caught up')}
          </div>
          <p className="max-w-[60ch] text-control text-muted-foreground">
            {t('approvals.caughtUp.sub', 'No {{kinds}} waiting in PMO. ERPNext documents are approved in ERPNext.', { kinds: caughtUpKinds })}
          </p>
        </div>
      ) : activeScope !== 'all' && activeScope !== 'procurement' && activeScope !== 'timesheets' ? (
        <div className="space-y-5">
          {activeScope === 'expense' && canShowExpenses && <ExpenseClaimApprovalSection />}
          {activeScope === 'imprest' && (
            waiting.failedKinds.includes('imprest') && waiting.countFor('imprest') === 0 ? (
              <ListState
                variant="error"
                title={t('approvals.previewError.title', "Couldn't load the selected queue")}
                sub={t('approvals.queue.loadErrorSub', 'Try again to refresh this queue.')}
                onRetry={() => void waiting.refetch()}
              />
            ) : waiting.pendingKinds.includes('imprest') && waiting.countFor('imprest') === 0 ? (
              <ListState variant="loading" rows={4} />
            ) : (
              <ImprestApprovalSection />
            )
          )}
          {activeScope === 'leave' && (
            <>
              {waiting.failedKinds.includes('leave') && (
                <div className="mb-4">
                  <ListState
                    variant="error"
                    title={t('approvals.previewError.title', "Couldn't load the selected queue")}
                    sub={t('approvals.queue.loadErrorSub', 'Try again to refresh this queue.')}
                    onRetry={() => void waiting.refetch()}
                  />
                </div>
              )}
              {waiting.pendingKinds.includes('leave') && waiting.countFor('leave') === 0 ? (
                <ListState variant="loading" rows={4} />
              ) : (
                <LeaveApprovalSection />
              )}
            </>
          )}
          {DATABASE_LISTED_KINDS.includes(activeScope as DatabaseListedKind) && <WaitingDecisionSection kind={activeScope as DatabaseListedKind} entries={allPopulation} />}
          {activeScope === 'invoice' && canShowInvoices && <SalesInvoiceApprovalSection />}
          {activeScope === 'material' && canShowMaterial && <MaterialRequestApprovalSection />}
          {activeScope === 'work_order_acceptance' && <WorkOrderAcceptanceSection entries={allPopulation} />}
        </div>
      ) : (
        <div className={showPreview ? 'grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:items-start' : undefined}>
          <Card
            variant="bare"
            role="region"
            aria-label={t('approvals.queueRegionLabel', 'Approvals queue')}
            data-testid="approvals-queue-region"
            className="min-w-0"
          >
            {/* #2497: the waiting block says what its figure counts, so the number is never a bare "2". */}
            <div
              data-testid="approvals-waiting-summary"
              className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-waiting-surface px-4 py-3"
            >
              <h2 className="flex min-w-0 items-baseline gap-2 text-base font-semibold text-foreground">
                <span data-testid="approvals-waiting-count" className="text-metric font-semibold tabular-nums">
                  {activeScope === 'all'
                    ? (allScopePending || waiting.count === undefined ? '—' : waiting.count)
                    : queueItems.length}
                </span>
                <span>{t('procurement:approvalQueue.waitingOnYou', 'waiting on your decision')}</span>
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                {(activeScope === 'all' || activeScope === 'timesheets') && canApproveTimesheets && <TimesheetBulkSelect controller={timesheetBulk} />}
                {(activeScope === 'all' || activeScope === 'procurement') && canApproveProcurement && <ProcurementBulkSelect controller={procurementBulk} />}
              </div>
            </div>

            {(activeScope === 'all' || activeScope === 'timesheets') && canApproveTimesheets && (
              <>
                <TimesheetBulkToolbar controller={timesheetBulk} sheets={timesheetRows} />
                <TimesheetBulkConfirm controller={timesheetBulk} sheets={timesheetRows} />
              </>
            )}

            {(activeScope === 'all' || activeScope === 'procurement') && canApproveProcurement && (
              <>
                <ProcurementBulkToolbar controller={procurementBulk} />
                <ProcurementBulkConfirm controller={procurementBulk} procurements={procurementRows} />
              </>
            )}

            <div className="space-y-5">
              {(activeScope === 'all' || activeScope === 'procurement') && canApproveProcurement && (
                <QueueGroup
                  title={t('approvals.group.procurement.title', 'Procurement cases')}
                  count={pendingProc}
                  items={procurementRows.map((row) => ({ key: `procurement:${row.id}`, kind: 'procurement' as const, row }))}
                  selectedKey={selectedKey}
                  onSelect={pickItem}
                  isPending={procPending}
                  isError={procError}
                  onRetry={() => refetchProc()}
                  emptyTitle={t(
                    'approvals.group.procurement.emptyTitle',
                    'No procurement cases awaiting your decision',
                  )}
                  hideWhenEmpty={activeScope === 'all' && (queueItems.length > 0 || otherDecisionCount > 0)}
                  procurementBulk={procurementBulk}
                />
              )}

              {(activeScope === 'all' || activeScope === 'timesheets') && canApproveTimesheets && (
                <QueueGroup
                  title={t('approvals.group.timesheets.title', 'Timesheets')}
                  count={pendingTs}
                  items={timesheetRows.map((row) => ({ key: `timesheets:${row.id}`, kind: 'timesheets' as const, row }))}
                  selectedKey={selectedKey}
                  onSelect={pickItem}
                  isPending={tsPending}
                  isError={tsError}
                  onRetry={() => refetchTimesheets()}
                  emptyTitle={t(
                    'approvals.group.timesheets.emptyTitle',
                    'No timesheets awaiting your decision',
                  )}
                  hideWhenEmpty={activeScope === 'all' && (queueItems.length > 0 || otherDecisionCount > 0)}
                  bulk={timesheetBulk}
                />
              )}
            </div>
          </Card>

          {showPreview && (
            <Card
              variant="bare"
              role="region"
              aria-label={t('approvals.previewRegionLabel', 'Approval preview')}
              id="approvals-preview"
              data-testid="approvals-preview-region"
              className="min-w-0 max-lg:px-4 max-lg:pb-4"
            >
              {selectedItem && <Button variant="outline" className="mb-3 lg:hidden" onClick={() => { setSelectedKey(null); document.querySelector('[data-testid="approvals-queue-region"]')?.scrollIntoView(); }}>{t('common:back', 'Back')}</Button>}
              {selectedItem ? (
                selectedItem.kind === 'procurement' ? (
                  <ProcurementApprovalPreview row={selectedItem.row} surface="panel" />
                ) : (
                  <TimesheetApprovalPreview sheet={selectedItem.row} surface="panel" eligibleFromQueue />
                )
              ) : (
                previewFallback ?? <p className="text-sm text-muted-foreground">{t('procurement:approvalQueue.pickItem', 'Pick an item above to see it and decide.')}</p>
            )}
          </Card>
          )}
        </div>
      )}

      {activeScope === 'all' && canShowExpenses && <ExpenseClaimApprovalSection />}
      {activeScope === 'all' && <ImprestApprovalSection />}
      {activeScope === 'all' && canShowInvoices && <SalesInvoiceApprovalSection />}
      {activeScope === 'all' && canShowMaterial && <MaterialRequestApprovalSection />}
      {/* #2708: renders nothing while leave requests are off or none waits for this viewer. */}
      {activeScope === 'all' && <LeaveApprovalSection />}
      {activeScope === 'all' && <WorkOrderAcceptanceSection entries={allPopulation} />}
      {activeScope === 'all' && DATABASE_LISTED_KINDS.map((kind) => <WaitingDecisionSection key={kind} kind={kind} entries={allPopulation} />)}
      {/* Renders nothing while no release is open and the viewer cannot open one. */}
      {activeScope === 'all' && <MedicalReleaseSection />}
      {hasTimesheetRole && <PushAttentionSection />}
      {hasTimesheetRole && <EmployeeLinkConfirmSection />}
      {canApproveTimesheets && <ReopenableApprovedSection hasPending={allPopulation.length > 0 || procPending || tsPending || expenseQuery.isPending || invoices.isPending} />}
    </div>
  );
};

export default ApprovalsPage;
