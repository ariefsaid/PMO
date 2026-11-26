import { WithheldPrice } from '@/src/components/ui/WithheldPrice';
import { useMaySeePrices } from '@/src/hooks/useHidePrices';
import React, { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, ListState, RecordSection, StatusPill, type Column } from '@/src/components/ui';
import { CanWrite } from '@/src/auth/usePermission';
import { useImprestOpenRequests } from '@/src/hooks/useImprest';
import { OPEN_REQUEST_LIMIT } from '@/src/lib/db/imprest';
import { foldRequests, seedFromRequests, type OpenRequest, type PlanSeedLine } from '@/src/lib/imprest/planSeed';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { formatCurrency } from '@/src/lib/format';

/**
 * Open purchase requests of this site's project, beside the monthly plan (cash-advance-estimate, FR-CAE-001..006): a read-only
 * suggestion of what is about to be bought, by purpose and work order. Nothing here writes; "Start the plan from these" only
 * fills the plan editor, which saves through the existing plan path.
 */
export const OpenRequestsSection: React.FC<{ floatId: string; currency: string; onStartPlan: (lines: PlanSeedLine[]) => void }> = ({ floatId, currency, onStartPlan }) => {
  const { t } = useTranslation();
  const maySeePrices = useMaySeePrices();
  const q = useImprestOpenRequests(floatId);
  const requests = useMemo(() => foldRequests(q.data?.rows ?? []), [q.data]);
  const seed = useMemo(() => seedFromRequests(requests, currency), [requests, currency]);
  const pricesHidden = !maySeePrices || requests.some((request) => request.total === null || request.lines.some((line) => line.amount === null));
  const money = (v: number | null, cur: string) => (pricesHidden || v === null ? '—' : formatCurrency(Number(v), cur));
  // One row per request, grouped by purpose: the request and its lines, its work order, its state, and its money on one
  // right edge (the request total, then each line's amount on the line it belongs to).
  const columns: Column<OpenRequest>[] = [
    { key: 'request', header: t('imprest:open.col.request', 'Request'), kind: 'primary', size: 300, ownActivation: true, cell: (r) => (
      <div className="min-w-0">
        <Link to={`/procurement/${r.id}`} className="font-medium text-primary-text hover:underline">{r.prNumber ?? r.title}</Link>
        {r.prNumber && <span className="ml-2 text-foreground">{r.title}</span>}
        <span className="block text-control text-muted-foreground">{r.workOrderLabel ?? t('imprest:open.noWorkOrder', 'No work order')}</span>
        {r.lines.map((l) => <span key={l.id} className="block text-control font-normal text-muted-foreground">{l.name} × {l.quantity}</span>)}
      </div>
    ) },
    { key: 'status', header: t('imprest:open.col.status', 'Status'), size: 130, cell: (r) => <StatusPill record="procurement" state={r.status} /> },
    { key: 'amount', header: t('imprest:open.col.amount', 'Amount'), kind: 'money', align: 'num', size: 150, cell: (r) => (
      <div className="flex flex-col items-end">
        <span className="tabular-nums">{money(r.total, r.currency)}</span>
        {r.lines.map((l) => <span key={l.id} className="tabular-nums text-control text-muted-foreground">{money(l.amount, r.currency)}</span>)}
      </div>
    ) },
  ];
  const reason = pricesHidden
    ? t('imprest:open.noPrices', 'Add the lines yourself in the plan.')
    : seed.lines.length === 0
      ? t('imprest:open.nothingToStart', 'To start a plan, a request needs a purpose and a visible total above zero in {{currency}}.', { currency })
      : null;

  return (
    <RecordSection
      title={t('imprest:open.title', 'Open purchase requests')}
      flush
      actions={requests.length > 0 && (
        <CanWrite entity="imprestPlan" action="create">
          <Button variant="outline" size="sm" disabled={reason !== null} onClick={() => onStartPlan(seed.lines)}>
            {t('imprest:open.startPlan', 'Start the plan from these')}
          </Button>
        </CanWrite>
      )}
    >
      <div data-testid="open-requests">
        {q.isPending && <div className="px-[var(--panel-inset)] pb-[var(--panel-inset)]"><ListState variant="loading" rows={2} /></div>}
        {q.isError && <div className="px-[var(--panel-inset)] pb-[var(--panel-inset)]"><ListState variant="error" title={t('imprest:open.error', "Couldn't load the open purchase requests")} onRetry={() => void q.refetch()} /></div>}
        {!q.isPending && !q.isError && requests.length === 0 && (
          <p className="px-[var(--panel-inset)] pb-[var(--panel-inset)] text-sm text-muted-foreground" data-testid="open-requests-empty">
            {t('imprest:open.empty', "No open purchase requests on this site's project. Project members raise one under Procurement, and it shows here until it is ordered.")}
          </p>
        )}
        {!q.isPending && !q.isError && requests.length > 0 && (
          <div className="space-y-3">
            {reason && <div className="px-[var(--panel-inset)] text-control text-muted-foreground" data-testid="open-requests-reason">{pricesHidden && <WithheldPrice />}{reason}</div>}
            {!reason && seed.skipped > 0 && (
              <p className="px-[var(--panel-inset)] text-control text-muted-foreground" data-testid="open-requests-skipped">
                {t('imprest:open.skipped', '{{count}} request(s) with no purpose, no visible price or another currency are not counted in the plan.', { count: seed.skipped })}
              </p>
            )}
            <DataTable
              embedded
              rows={requests}
              columns={columns}
              rowKey={(r) => r.id}
              tableId="imprest-open-requests"
              accessibleName={t('imprest:open.title', 'Open purchase requests')}
              groupBy={(r) => r.category ?? ''}
              groupLabel={(key) => (key ? budgetCategoryLabel(key as OpenRequest['category'] & string, t) : t('imprest:open.noPurpose', 'No purpose set'))}
            />
            {q.data?.truncated && <p role="status" className="px-[var(--panel-inset)] pb-[var(--panel-inset)] text-control text-muted-foreground">
              {t('imprest:open.truncated', 'Showing the first {{count}} lines only.', { count: OPEN_REQUEST_LIMIT })}
            </p>}
          </div>
        )}
      </div>
    </RecordSection>
  );
};
