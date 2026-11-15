import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AccessDenied, Badge, Button, Card, Drawer, ListState, PageHeader, SelectField, ViewToggle } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useTimesheetsAwaitingApproval, useReopenableApprovedTimesheets } from '@/src/hooks/useTimesheetApproval';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { TimesheetApprovalPreview } from './timesheets/ApprovalsQueue';
import { TimesheetBulkConfirm, TimesheetBulkToolbar, useTimesheetBulkApprove, weekLabel } from './timesheets/TimesheetBulkApprove';
import { ProcurementBulkConfirm, ProcurementBulkToolbar } from './approvals/ProcurementBulkApprove';
import { useProcurementBulkApprove } from './approvals/useProcurementBulkApprove';
import { ExpenseClaimApprovalSection } from './approvals/ExpenseClaimApprovalSection';
import { ImprestApprovalSection } from './approvals/ImprestApprovalSection';
import { SalesInvoiceApprovalSection } from './approvals/SalesInvoiceApprovalSection';
import { PushAttentionSection } from './approvals/PushAttentionSection';
import { EmployeeLinkConfirmSection } from './approvals/EmployeeLinkConfirmSection';
import { ReopenableApprovedSection } from './approvals/ReopenableApprovedSection';
import { QueueGroup, type QueueItem } from './approvals/ApprovalQueue';
import { timesheetWaitingSince } from '@/src/lib/selectors/approvalUrgency';
import { useInvoicesAwaitingViewer } from '@/src/hooks/useInvoicesAwaitingViewer';
import { ProcurementApprovalPreview } from './approvals/ProcurementApprovalRow';
import { pendingProcurementApprovals, type ApprovalPopulationEntry, type ApprovalScope } from '@/src/lib/selectors/approvals';
import { useApprovalPopulation } from '@/src/hooks/useApprovalPopulation';
import { useExpenseClaimsAwaitingDecision, type ExpenseClaimAwaiting } from '@/src/hooks/useExpenseClaims';
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
  const location = useLocation();
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
  const allCaughtUp = procSettledEmpty && tsSettledEmpty && invSettledEmpty && expenseSettledEmpty;
  const allScopePending = (canApproveProcurement && procPending) || (canApproveTimesheets && (tsPending || correctionPending)) || (canShowExpenses && expenseQuery.isPending) || (canShowInvoices && invoices.isPending);

  const populationEntries = useMemo<ApprovalPopulationEntry[]>(() => [
    ...(canApproveProcurement ? procurementRows.map((row) => ({ key: `procurement:${row.id}`, kind: 'procurement' as const, createdAt: row.created_at, row })) : []),
    ...(canApproveTimesheets ? timesheetRows.map((row) => ({ key: `timesheets:${row.id}`, kind: 'timesheets' as const, createdAt: row.week_start_date, row })) : []),
    ...(canShowExpenses ? expenseRows.map((entry: ExpenseClaimAwaiting) => ({ key: `expense:${entry.claim.id}`, kind: 'expense' as const, createdAt: entry.claim.created_at, row: entry })) : []),
    ...(canShowInvoices ? invoices.rows.map((row) => ({ key: `invoice:${row.id}`, kind: 'invoice' as const, createdAt: row.created_at, row })) : []),
  ], [canApproveProcurement, canApproveTimesheets, canShowExpenses, canShowInvoices, procurementRows, timesheetRows, expenseRows, invoices.rows]);
  const allPopulation = useApprovalPopulation(populationEntries, 'all');
  const countFor = (kind: Scope) => allPopulation.filter((entry: ApprovalPopulationEntry) => entry.kind === kind).length;
  // A tab shows its count as soon as ITS queue has answered (0 included); "All" once every queue has.
  const scopeSettled: Record<Scope, boolean> = {
    procurement: !procPending && !procError,
    timesheets: !tsPending && !tsError && !correctionPending && !correctionError,
    expense: !expenseQuery.isPending && !expenseQuery.isError,
    invoice: !invoices.isPending && !invoices.isError,
    all: false,
  };
  scopeSettled.all = availableKinds.every((kind) => scopeSettled[kind]);
  const knownCount = (scope: Scope): number | undefined =>
    scopeSettled[scope] ? (scope === 'all' ? allPopulation.length : countFor(scope)) : undefined;
  const scopeLabels: Record<Scope, string> = {
    all: t('approvals.scope.all', 'All pending'),
    procurement: t('approvals.scope.procurement', 'Procurement cases'),
    timesheets: t('approvals.scope.timesheets', 'Timesheets'),
    expense: t('approvals.scope.expense', 'Expense claims'),
    invoice: t('approvals.scope.invoice', 'Customer invoices'),
  };
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

  // The open item lives in the URL (reload and Back keep it). With none chosen, the oldest money decision
  // opens: the oldest purchase, else the longest-waiting week. It is decided only once the queues it
  // compares have answered, so a fast queue never claims the column ahead of an older, slower one.
  const pickedKey = searchParams.get('item');
  const defaultKey = useMemo(() => {
    const procInScope = (activeScope === 'all' || activeScope === 'procurement') && canApproveProcurement;
    const tsInScope = (activeScope === 'all' || activeScope === 'timesheets') && canApproveTimesheets;
    if ((procInScope && procPending) || (tsInScope && tsPending)) return null;
    const money = queueItems.find((item) => item.kind === 'procurement');
    if (money) return money.key;
    const weeks = queueItems
      .filter((item): item is Extract<QueueItem, { kind: 'timesheets' }> => item.kind === 'timesheets')
      .sort((a, b) => timesheetWaitingSince(a.row).localeCompare(timesheetWaitingSince(b.row)));
    return weeks[0]?.key ?? null;
  }, [activeScope, canApproveProcurement, canApproveTimesheets, procPending, tsPending, queueItems]);
  const pickedItem = pickedKey ? queueItems.find((item) => item.key === pickedKey) ?? null : null;
  const selectedKey = pickedItem ? pickedItem.key : defaultKey;
  const selectedItem = queueItems.find((item) => item.key === selectedKey) ?? null;

  // Desktop swaps the open item in place; a phone opens it as a sheet that Back closes.
  const pickItem = (key: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('item', key);
    setSearchParams(params, isLargeScreen ? { replace: true } : { state: { approvalsSheet: true } });
  };
  const closeSheet = () => {
    // Opened from the list: step back so the phone's Back and the close button agree.
    if ((location.state as { approvalsSheet?: boolean } | null)?.approvalsSheet) {
      navigate(-1);
      return;
    }
    const params = new URLSearchParams(searchParams);
    params.delete('item');
    setSearchParams(params, { replace: true });
  };
  const sheetItem = !isLargeScreen ? pickedItem : null;
  const itemTitle = (item: QueueItem) => item.kind === 'procurement'
    ? item.row.title
    : `${item.row.owner?.full_name ?? t('approvals.unknownOwner', 'Unknown')} · ${weekLabel(item.row.week_start_date, t)}`;

  const procInView = (activeScope === 'all' || activeScope === 'procurement') && canApproveProcurement;
  const tsInView = (activeScope === 'all' || activeScope === 'timesheets') && canApproveTimesheets;
  const selecting = (procInView && procurementBulk.selecting) || (tsInView && timesheetBulk.selecting);
  const canBulk = (procInView && procurementBulk.approvableIds.size > 0) || (tsInView && timesheetBulk.approvableIds.size > 0);
  const startSelecting = () => {
    if (procInView && procurementBulk.approvableIds.size > 0) procurementBulk.setSelecting(true);
    if (tsInView && timesheetBulk.approvableIds.size > 0) timesheetBulk.setSelecting(true);
  };
  const stopSelecting = () => {
    procurementBulk.exitSelection();
    timesheetBulk.exitSelection();
  };

  if (!canApproveProcurement && !canApproveTimesheets && !canShowInvoices) {
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

  const previewFallback = (() => {
    if (queueItems.length > 0) return null;
    const includesExpenses = (activeScope === 'all' || activeScope === 'expense') && canShowExpenses;
    const includesInvoices = (activeScope === 'all' || activeScope === 'invoice') && canShowInvoices;
    const currentPending = activeScope === 'procurement' ? procPending
      : activeScope === 'timesheets' ? tsPending || correctionPending
        : activeScope === 'expense' ? expenseQuery.isPending
          : activeScope === 'invoice' ? invoices.isPending
            : (canApproveProcurement && procPending) || (canApproveTimesheets && (tsPending || correctionPending)) || (includesExpenses && expenseQuery.isPending) || (includesInvoices && invoices.isPending);
    const currentError = activeScope === 'procurement' ? procError
      : activeScope === 'timesheets' ? tsError || correctionError
        : activeScope === 'expense' ? expenseQuery.isError
          : activeScope === 'invoice' ? invoices.isError
            : (canApproveProcurement && procError) || (canApproveTimesheets && (tsError || correctionError)) || (includesExpenses && expenseQuery.isError) || (includesInvoices && invoices.isError);

    const retryCurrentError = () => {
      if (activeScope === 'procurement') void refetchProc();
      else if (activeScope === 'timesheets') {
        if (tsError) void refetchTimesheets();
        if (correctionError) void refetchCorrections();
      } else if (activeScope === 'expense') void expenseQuery.refetch();
      else if (activeScope === 'invoice') void invoices.refetch();
      else {
        if (canApproveProcurement && procError) void refetchProc();
        if (canApproveTimesheets && tsError) void refetchTimesheets();
        if (canApproveTimesheets && correctionError) void refetchCorrections();
        if (includesExpenses && expenseQuery.isError) void expenseQuery.refetch();
        if (includesInvoices && invoices.isError) void invoices.refetch();
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
                className="max-w-full"
                options={availableScopes.map((scope) => ({
                  value: scope,
                  label: scopeLabels[scope],
                  icon: ({ all: 'grid', procurement: 'cart', timesheets: 'clock', expense: 'file', invoice: 'file' } as const)[scope],
                  count: knownCount(scope),
                  showZeroCount: true,
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
              options={availableScopes.map((scope) => {
                const count = knownCount(scope);
                return { value: scope, label: count === undefined ? scopeLabels[scope] : `${scopeLabels[scope]} · ${count}` };
              })}
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
          className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card px-6 py-14 text-center"
          data-testid="approvals-caught-up"
        >
          <div className="text-[16px] font-semibold">
            {t('approvals.caughtUp.title', 'You’re all caught up')}
          </div>
          <p className="max-w-[60ch] text-control text-muted-foreground">
            {t('approvals.caughtUp.sub', 'No {{kinds}} waiting in PMO. ERPNext documents are approved in ERPNext.', { kinds: caughtUpKinds })}
          </p>
        </div>
      ) : activeScope === 'expense' || activeScope === 'invoice' ? (
        <div className="space-y-5">
          {activeScope === 'expense' && canShowExpenses && <ExpenseClaimApprovalSection />}
          {activeScope === 'expense' && canApproveExpenses && <ImprestApprovalSection />}
          {activeScope === 'invoice' && canShowInvoices && <SalesInvoiceApprovalSection />}
        </div>
      ) : (
        // The two columns end before the blocks below start: the sections under them carry only a bottom margin.
        <div data-testid="approvals-decision-grid" className="mb-8 grid gap-8 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:items-start">
          <Card
            variant="bare"
            role="region"
            aria-label={t('approvals.queueRegionLabel', 'Approvals queue')}
            data-testid="approvals-queue-region"
            className="min-w-0"
          >
            {/* One calm control for bulk work; how many wait is on the tab, not repeated here. */}
            <div data-testid="approvals-list-header" className={['mb-3 flex min-h-8 items-center gap-3', hasTabs ? 'justify-end' : 'justify-between'].join(' ')}>
              {/* With tabs, the selected tab already names this list; the heading stays for screen readers. */}
              <h2 className={hasTabs ? 'sr-only' : 'flex items-center gap-2 text-base font-semibold'}>
                {activeScope === 'all' ? t('procurement:approvalQueue.headingAll', 'Purchases and timesheets') : scopeLabels[activeScope]}
                {/* With no tabs there is nowhere else to say how many wait. */}
                {!hasTabs && <Badge>{queueItems.length}</Badge>}
              </h2>
              {selecting ? (
                <Button variant="ghost" size="sm" className="max-lg:min-h-11" onClick={stopSelecting}>
                  {t('procurement:approvalQueue.doneSelecting', 'Done')}
                </Button>
              ) : canBulk ? (
                <Button variant="outline" size="sm" className="max-lg:min-h-11" onClick={startSelecting}>
                  {t('procurement:approvalQueue.selectItems', 'Select')}
                </Button>
              ) : null}
            </div>

            {tsInView && <TimesheetBulkConfirm controller={timesheetBulk} sheets={timesheetRows} />}
            {procInView && <ProcurementBulkConfirm controller={procurementBulk} procurements={procurementRows} />}

            <div className="space-y-5">
              {procInView && (
                <QueueGroup
                  title={t('approvals.group.procurement.title', 'Procurement cases')}
                  count={pendingProc}
                  items={procurementRows.map((row) => ({ key: `procurement:${row.id}`, kind: 'procurement' as const, row }))}
                  selectedKey={isLargeScreen ? selectedKey : sheetItem?.key ?? null}
                  onSelect={pickItem}
                  isPending={procPending || (activeScope === 'all' && allScopePending && procurementRows.length === 0)}
                  isError={procError}
                  onRetry={() => refetchProc()}
                  emptyTitle={t(
                    'approvals.group.procurement.emptyTitle',
                    'No procurement cases awaiting your decision',
                  )}
                  hideWhenEmpty={activeScope === 'all' && queueItems.length > 0}
                  procurementBulk={procurementBulk}
                  toolbar={<ProcurementBulkToolbar controller={procurementBulk} />}
                />
              )}

              {tsInView && (
                <QueueGroup
                  title={t('approvals.group.timesheets.title', 'Timesheets')}
                  count={pendingTs}
                  items={timesheetRows.map((row) => ({ key: `timesheets:${row.id}`, kind: 'timesheets' as const, row }))}
                  selectedKey={isLargeScreen ? selectedKey : sheetItem?.key ?? null}
                  onSelect={pickItem}
                  isPending={tsPending || (activeScope === 'all' && allScopePending && timesheetRows.length === 0)}
                  isError={tsError}
                  onRetry={() => refetchTimesheets()}
                  emptyTitle={t(
                    'approvals.group.timesheets.emptyTitle',
                    'No timesheets awaiting your decision',
                  )}
                  hideWhenEmpty={activeScope === 'all' && queueItems.length > 0}
                  bulk={timesheetBulk}
                  toolbar={<TimesheetBulkToolbar controller={timesheetBulk} sheets={timesheetRows} />}
                />
              )}
            </div>
          </Card>

          {isLargeScreen && (
            <Card
              variant="bare"
              role="region"
              aria-label={t('approvals.previewRegionLabel', 'Approval preview')}
              id="approvals-preview"
              data-testid="approvals-preview-region"
              className="min-w-0"
            >
              {selectedItem ? (
                selectedItem.kind === 'procurement' ? (
                  <ProcurementApprovalPreview row={selectedItem.row} surface="panel" />
                ) : (
                  <TimesheetApprovalPreview sheet={selectedItem.row} surface="panel" eligibleFromQueue />
                )
              ) : (
                previewFallback
              )}
            </Card>
          )}
        </div>
      )}

      {/* Phone: the tapped item opens full screen, its decision fixed at the thumb. */}
      {!isLargeScreen && (
        <Drawer
          open={sheetItem != null}
          title={sheetItem ? itemTitle(sheetItem) : ''}
          onClose={closeSheet}
          width="lg"
        >
          {sheetItem ? (
            <div data-testid="approvals-preview-region">
              {sheetItem.kind === 'procurement' ? (
                <ProcurementApprovalPreview row={sheetItem.row} surface="sheet" />
              ) : (
                <TimesheetApprovalPreview sheet={sheetItem.row} surface="sheet" eligibleFromQueue />
              )}
            </div>
          ) : null}
        </Drawer>
      )}

      {activeScope === 'all' && canShowExpenses && <ExpenseClaimApprovalSection />}
      {activeScope === 'all' && canApproveExpenses && <ImprestApprovalSection />}
      {activeScope === 'all' && canShowInvoices && <SalesInvoiceApprovalSection />}
      {hasTimesheetRole && <PushAttentionSection />}
      {hasTimesheetRole && <EmployeeLinkConfirmSection />}
      {canApproveTimesheets && <ReopenableApprovedSection hasPending={allPopulation.length > 0 || procPending || tsPending || expenseQuery.isPending || invoices.isPending} />}
    </div>
  );
};

export default ApprovalsPage;
