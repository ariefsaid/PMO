import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AccessDenied, Badge, Card, ListState, StatusPill, ViewToggle } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useProcurements } from '@/src/hooks/useProcurements';
import {
  useTimesheetsAwaitingApproval,
  usePushesNeedingAttention,
  useEmployeeLinkConfirm,
} from '@/src/hooks/useTimesheetApproval';
import { useAuth } from '@/src/auth/useAuth';
import { ApprovalsQueue } from './timesheets/ApprovalsQueue';
import { TimesheetApprovalPreview } from './timesheets/ApprovalsQueue';
import { ProcurementApprovalSection } from './approvals/ProcurementApprovalSection';
import { ProcurementApprovalPreview } from './approvals/ProcurementApprovalRow';
import { pendingProcurementApprovals } from '@/src/lib/selectors/approvals';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import { formatCurrency } from '@/src/lib/format';
import { PushStateBadge } from '@/src/components/timesheets/PushStateBadge';
import { EmployeeLinkConfirm } from '@/src/components/timesheets/EmployeeLinkConfirm';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type { TimesheetAwaitingApproval } from '@/src/lib/db/timesheetTransition';

/** `lg` breakpoint — the two-pane triage activates here. */
const TRIAGE_QUERY = '(min-width: 1024px)';

type Scope = 'all' | 'procurement' | 'timesheets';

type QueueItem =
  | { key: string; kind: 'procurement'; row: ProcurementWithRefs }
  | { key: string; kind: 'timesheets'; row: TimesheetAwaitingApproval };

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

function weekLabel(weekStart: string): string {
  const [y, m, d] = weekStart.split('-').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return `Week of ${dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

function sumHours(sheet: TimesheetAwaitingApproval): number {
  return sheet.entries.reduce((sum, e) => sum + e.hours, 0);
}

function QueueButton({
  item,
  selected,
  onSelect,
}: {
  item: QueueItem;
  selected: boolean;
  onSelect: () => void;
}) {
  if (item.kind === 'procurement') {
    const row = item.row;
    return (
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={[
          'w-full rounded-lg border px-3 py-3 text-left transition-colors',
          selected ? 'border-foreground/20 bg-secondary/70' : 'border-transparent hover:border-border hover:bg-secondary/40',
        ].join(' ')}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{row.title}</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
              <span>{row.requested_by?.full_name ?? 'Unknown requester'}</span>
              <span>·</span>
              <span className="font-mono">{row.code ?? row.id.slice(0, 8)}</span>
            </div>
          </div>
          <StatusPill variant={workflowVariant(row.status)}>{row.status}</StatusPill>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
          <span>{row.project?.name ?? 'No project linked'}</span>
          <span className="tabular font-medium text-foreground">{formatCurrency(row.total_value)}</span>
        </div>
      </button>
    );
  }

  const row = item.row;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={[
        'w-full rounded-lg border px-3 py-3 text-left transition-colors',
        selected ? 'border-foreground/20 bg-secondary/70' : 'border-transparent hover:border-border hover:bg-secondary/40',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{row.owner?.full_name ?? 'Unknown'}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
            <span>{weekLabel(row.week_start_date)}</span>
            <span>·</span>
            <span>{row.entries[0]?.project?.name ?? 'No project linked'}</span>
          </div>
        </div>
        <StatusPill variant={workflowVariant(row.status)}>{row.status}</StatusPill>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
        <span>{row.entries.length} entr{row.entries.length === 1 ? 'y' : 'ies'}</span>
        <span className="tabular font-medium text-foreground">{sumHours(row).toFixed(1)} h</span>
      </div>
    </button>
  );
}

function QueueGroup({
  title,
  count,
  items,
  selectedKey,
  onSelect,
  isPending,
  isError,
  onRetry,
  emptyTitle,
  emptySub,
}: {
  title: string;
  count: number;
  items: QueueItem[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  emptyTitle: string;
  emptySub: string;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {title}
        </h2>
        <Badge>{count}</Badge>
      </div>

      {isPending ? (
        <ListState variant="loading" rows={2} className="rounded-lg border border-border/70 p-0" />
      ) : isError ? (
        <ListState
          variant="error"
          title={`Couldn't load ${title.toLowerCase()}`}
          sub="Try again to refresh this queue."
          onRetry={onRetry}
        />
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/80">
          <ListState variant="empty" title={emptyTitle} sub={emptySub} className="px-4 py-8" />
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => (
            <QueueButton
              key={item.key}
              item={item}
              selected={selectedKey === item.key}
              onSelect={() => onSelect(item.key)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * P3b (FR-TSP-085) — the "needs attention" ERP-push queue. Every `failed`/`held` push visible to the
 * caller (RLS is the only scoping authority, task 4.x). NOTHING renders when the list is empty — an
 * unflipped org, or one with no failures, sees no trace of this section (FR-TSP-173).
 */
function PushAttentionSection() {
  const { currentUser } = useAuth();
  const may = usePermission();
  const { data, isPending, isError, retry: retryMutation } = usePushesNeedingAttention();
  const [retryingId, setRetryingId] = useState<string | null>(null);

  if (isPending || isError || !data || data.length === 0) return null;

  return (
    <section className="mb-4" aria-label="ERP pushes needing attention">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        ERP pushes needing attention
      </h2>
      <div className="space-y-1.5">
        {data.map((row) => {
          const canRetry = may('push_timesheet', 'timesheet', {
            currentUserId: currentUser?.id,
            record: { approved_by: row.approved_by },
          });
          return (
            <div
              key={row.timesheet_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium">{row.owner_name}</div>
                <div className="mt-0.5 text-[12px] text-muted-foreground">{weekLabel(row.week_start_date)}</div>
              </div>
              <PushStateBadge
                state={{ push_state: row.push_state, push_error: row.push_error, ts_number: row.ts_number }}
                canRetry={canRetry}
                retryLoading={retryingId === row.timesheet_id && retryMutation.isPending}
                onRetry={() => {
                  setRetryingId(row.timesheet_id);
                  retryMutation.mutate(
                    { timesheetId: row.timesheet_id },
                    { onSettled: () => setRetryingId(null) },
                  );
                }}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * P3b (OQ-TSP-10(C) — the owner ruling) — the Employee-adopt-link Admin queue. Renders nothing when
 * there is no proposed link (the common case for every org that hasn't flipped `timesheets`).
 */
function EmployeeLinkConfirmSection() {
  const may = usePermission();
  const { links, confirm } = useEmployeeLinkConfirm();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  if (links.isPending || links.isError || !links.data || links.data.length === 0) return null;

  return (
    <section className="mb-4" aria-label="Employee links awaiting confirmation">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        Employee links awaiting confirmation
      </h2>
      <EmployeeLinkConfirm
        links={links.data}
        canConfirm={may('confirm_employee_link', 'employeeLink')}
        confirmingId={confirmingId}
        onConfirm={(link) => {
          setConfirmingId(link.id);
          confirm.mutate(
            { erpEmployeeId: link.id, profileId: link.profile_id ?? '' },
            { onSettled: () => setConfirmingId(null) },
          );
        }}
      />
    </section>
  );
}

const ApprovalsPage: React.FC = () => {
  const may = usePermission();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const selfId = currentUser?.id;
  const [searchParams, setSearchParams] = useSearchParams();
  const isLargeScreen = useIsLargeScreen();

  const canApproveProcurement = may('transition', 'procurement');
  const canApproveTimesheets = may('transition', 'approval');

  const { data: procurements, isPending: procPending, isError: procError, refetch: refetchProc } = useProcurements();
  const { data: timesheets, isPending: tsPending, isError: tsError, refetch: refetchTimesheets } = useTimesheetsAwaitingApproval();

  const procurementRows = useMemo(
    () => pendingProcurementApprovals(procurements, selfId).sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    ),
    [procurements, selfId],
  );
  const timesheetRows = useMemo(() => timesheets ?? [], [timesheets]);

  const availableScopes: Scope[] = [
    ...(canApproveProcurement && canApproveTimesheets ? (['all'] as const) : []),
    ...(canApproveProcurement ? (['procurement'] as const) : []),
    ...(canApproveTimesheets ? (['timesheets'] as const) : []),
  ];
  const hasTabs = availableScopes.length > 1;
  const urlScope = searchParams.get('scope') as Scope | null;
  const activeScope: Scope =
    urlScope && availableScopes.includes(urlScope)
      ? urlScope
      : canApproveProcurement && canApproveTimesheets
        ? 'all'
        : availableScopes[0];

  const selectScope = (next: Scope) => {
    const params = new URLSearchParams(searchParams);
    params.set('scope', next);
    setSearchParams(params, { replace: true });
  };

  const pendingProc = canApproveProcurement ? procurementRows.length : 0;
  const pendingTs = canApproveTimesheets ? timesheetRows.length : 0;

  const procSettledEmpty = !canApproveProcurement || (!procPending && !procError && pendingProc === 0);
  const tsSettledEmpty = !canApproveTimesheets || (!tsPending && !tsError && pendingTs === 0);
  const allCaughtUp = procSettledEmpty && tsSettledEmpty;

  const queueItems = useMemo<QueueItem[]>(() => {
    const items: QueueItem[] = [];
    if (activeScope !== 'timesheets') {
      items.push(...procurementRows.map((row) => ({ key: `procurement:${row.id}`, kind: 'procurement' as const, row })));
    }
    if (activeScope !== 'procurement') {
      items.push(...timesheetRows.map((row) => ({ key: `timesheets:${row.id}`, kind: 'timesheets' as const, row })));
    }
    return items;
  }, [activeScope, procurementRows, timesheetRows]);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    if (queueItems.length === 0) {
      setSelectedKey(null);
      return;
    }
    if (!selectedKey || !queueItems.some((item) => item.key === selectedKey)) {
      setSelectedKey(queueItems[0].key);
    }
  }, [queueItems, selectedKey]);

  const selectedItem = queueItems.find((item) => item.key === selectedKey) ?? null;

  if (!canApproveProcurement && !canApproveTimesheets) {
    return (
      <AccessDenied
        title="You don't have access to approvals"
        sub="Approvals are for the roles that sign off purchase requests or timesheets. Your work lives on your dashboard, projects, and tasks."
        onBack={() => navigate('/')}
      />
    );
  }

  const previewFallback = (() => {
    if (queueItems.length > 0) return null;
    const currentPending =
      activeScope === 'procurement' ? procPending : activeScope === 'timesheets' ? tsPending : procPending || tsPending;
    const currentError =
      activeScope === 'procurement' ? procError : activeScope === 'timesheets' ? tsError : procError || tsError;

    if (currentPending) return <ListState variant="loading" rows={4} />;
    if (currentError) {
      return (
        <ListState
          variant="error"
          title="Couldn't load the selected queue"
          sub="Retry from the queue pane to refresh the latest approvals."
        />
      );
    }
    return (
      <ListState
        variant="empty"
        icon="inbox"
        title="Select an approval item"
        sub="When a pending request is available, its preview and actions appear here."
      />
    );
  })();

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-[24px] font-bold tracking-[-0.02em]">Approvals</h1>
        <p className="mt-0.5 max-w-[72ch] text-sm text-muted-foreground">
          Needs my approval — everything waiting on your decision, across procurement and timesheets.
        </p>
      </div>

      {canApproveTimesheets && <PushAttentionSection />}
      {canApproveTimesheets && <EmployeeLinkConfirmSection />}

      {hasTabs && !allCaughtUp && (
        <div className="mb-4 min-w-0">
          <div
            data-testid="approvals-scope-scroll"
            className="min-w-0 overflow-x-auto scroll-fade-x lg:overflow-visible"
          >
            <ViewToggle<Scope>
              className="max-w-full"
              options={[
                ...(canApproveProcurement && canApproveTimesheets
                  ? [{ value: 'all' as const, label: 'All', icon: 'grid' as const, count: pendingProc + pendingTs }]
                  : []),
                ...(canApproveProcurement
                  ? [{ value: 'procurement' as const, label: 'Procurement', icon: 'cart' as const, count: pendingProc }]
                  : []),
                ...(canApproveTimesheets
                  ? [{ value: 'timesheets' as const, label: 'Timesheets', icon: 'clock' as const, count: pendingTs }]
                  : []),
              ]}
              value={activeScope}
              onChange={selectScope}
              ariaLabel="Approvals scope"
            />
          </div>
        </div>
      )}

      {allCaughtUp ? (
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card px-6 py-14 text-center"
          data-testid="approvals-caught-up"
        >
          <div className="text-[15px] font-semibold">You&rsquo;re all caught up</div>
          <p className="max-w-[44ch] text-[13px] text-muted-foreground">
            Nothing is waiting on your approval right now. New purchase requests and submitted
            timesheets will appear here.
          </p>
        </div>
      ) : isLargeScreen ? (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:items-start">
          <Card variant="bare" role="region" aria-label="Approvals queue" className="min-w-0">
            <div className="mb-4 flex items-center justify-between gap-2 border-b border-border pb-3">
              <div>
                <h2 className="text-base font-semibold">Approvals queue</h2>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  Select an item to preview its details and decision controls.
                </p>
              </div>
              <Badge>{queueItems.length}</Badge>
            </div>

            <div className="space-y-5">
              {activeScope !== 'timesheets' && canApproveProcurement && (
                <QueueGroup
                  title="Purchase requests"
                  count={pendingProc}
                  items={procurementRows.map((row) => ({ key: `procurement:${row.id}`, kind: 'procurement' as const, row }))}
                  selectedKey={selectedKey}
                  onSelect={setSelectedKey}
                  isPending={procPending}
                  isError={procError}
                  onRetry={() => refetchProc()}
                  emptyTitle="No requests awaiting your decision"
                  emptySub="Purchase requests that need your approval will appear here."
                />
              )}

              {activeScope !== 'procurement' && canApproveTimesheets && (
                <QueueGroup
                  title="Timesheets"
                  count={pendingTs}
                  items={timesheetRows.map((row) => ({ key: `timesheets:${row.id}`, kind: 'timesheets' as const, row }))}
                  selectedKey={selectedKey}
                  onSelect={setSelectedKey}
                  isPending={tsPending}
                  isError={tsError}
                  onRetry={() => refetchTimesheets()}
                  emptyTitle="No timesheets awaiting your decision"
                  emptySub="Submitted timesheets from your reports will appear here for review."
                />
              )}
            </div>
          </Card>

          <Card variant="bare" role="region" aria-label="Approval preview" className="min-w-0">
            {selectedItem ? (
              selectedItem.kind === 'procurement' ? (
                <ProcurementApprovalPreview row={selectedItem.row} surface="panel" />
              ) : (
                <TimesheetApprovalPreview sheet={selectedItem.row} surface="panel" />
              )
            ) : (
              previewFallback
            )}
          </Card>
        </div>
      ) : (
        <div className="space-y-5">
          {(activeScope === 'all' || activeScope === 'procurement') && canApproveProcurement && (
            <section aria-label="Purchase requests awaiting you">
              <ProcurementApprovalSection />
            </section>
          )}
          {(activeScope === 'all' || activeScope === 'timesheets') && canApproveTimesheets && (
            <section aria-label="Timesheets awaiting you">
              <h2 className="mb-2 text-sm font-semibold">Timesheets awaiting you</h2>
              <ApprovalsQueue />
            </section>
          )}
        </div>
      )}
    </div>
  );
};

export default ApprovalsPage;
