import React, { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState, PageHeader } from '@/src/components/ui';
import { BillingPlanLink } from '@/src/components/finance/BillingPlanLink';
import { Combobox, type ComboboxOption } from '@/src/components/ui/Combobox';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { useBillingBoard } from '@/src/hooks/useBillingBoard';
import { useRoleOptions } from '@/src/hooks/useRoleOptions';
import { groupBoard, type BoardCard, type BoardColumn } from '@/src/lib/billingBoard';
import { BOARD_LIMIT } from '@/src/lib/db/billingBoard';
import { BillingBoardWorkOrderSteps } from './BillingBoardWorkOrderSteps';

/**
 * #2681 — the billing board: every open claim by step and age (docs/specs/billing-board.spec.md). A read-only view over the claims'
 * own steps; no drag, no write. Moving a claim = completing its step on the claim, which the card opens. Columns on desktop (scrolling
 * sideways), stacked sections on a phone.
 */

const claimHref = (c: BoardCard) =>
  `/projects/${c.projectId}?tab=billing&open=${c.claimId}&openType=billingClaim`;

const ClaimCard: React.FC<{ card: BoardCard }> = ({ card }) => {
  const { t } = useTranslation('finance');
  const roles = useRoleOptions();
  return (
    <li>
      <Link
        to={claimHref(card)}
        data-testid="billing-board-card"
        className="block min-h-11 rounded-md border border-border bg-card p-3 text-control hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <span className="block truncate font-medium">{card.projectName}</span>
        {card.woNumber && <span className="block truncate text-muted-foreground">{t('billingBoard.workOrder', { defaultValue: 'Work order {{number}}', number: card.woNumber })}</span>}
        <span className="mt-1 block text-muted-foreground">{t('billingBoard.progress', { defaultValue: '{{done}} of {{total}} steps', done: card.stepsDone, total: card.stepCount })}</span>
        {card.ownerRole && <span className="block text-muted-foreground">{t('billingBoard.holder', { defaultValue: 'Waiting on {{role}}', role: roles.label(card.ownerRole) })}</span>}
        <span className="mt-2 flex flex-wrap items-center gap-2">
          <span data-testid="billing-board-age" className="tabular-nums">
            {card.ageDays === null
              ? t('billingBoard.notStarted', 'Not started')
              : t('billingBoard.age', { defaultValue: '{{count}} days on this step', count: card.ageDays })}
          </span>
          {card.overdueDays !== null && (
            <StatusPill variant="overdue">
              {t('billingBoard.overdue', { defaultValue: '{{count}} days past target', count: card.overdueDays })}
            </StatusPill>
          )}
        </span>
      </Link>
    </li>
  );
};

const Column: React.FC<{ column: BoardColumn }> = ({ column }) => {
  const { t } = useTranslation('finance');
  const title = column.allDone ? t('billingBoard.allDone', 'All steps done') : column.name;
  return (
    <section aria-label={title ?? undefined} data-testid="billing-board-column" className="min-w-0 md:w-72 md:shrink-0">
      <h2 className="mb-2 flex items-baseline justify-between gap-2 text-[14px] font-semibold">
        <span className="truncate">{title}</span>
        <span className="tabular-nums text-muted-foreground">{column.claimCount}</span>
      </h2>
      <div data-testid="billing-board-column-totals" className="mb-2 space-y-0.5 text-control tabular-nums text-muted-foreground">
        {column.totals.map((total) => (
          <p key={total.currency}>{t('billingBoard.columnTotal', { defaultValue: '{{amount}} {{currency}} total', amount: total.amount ?? '—', currency: total.currency })}</p>
        ))}
      </div>
      {column.allDone && <p className="mb-2 text-control text-muted-foreground">{t('billingBoard.allDoneHint', 'Ready to invoice. Age counts from the last step.')}</p>}
      <ul className="flex flex-col gap-2">
        {column.cards.map((card) => <ClaimCard key={card.claimId} card={card} />)}
      </ul>
    </section>
  );
};

const BillingBoard: React.FC = () => {
  const { t } = useTranslation('finance');
  const [params, setParams] = useSearchParams();
  const all = useBillingBoard(null);
  const wantedProject = params.get('project');
  const projectOptions: ComboboxOption[] = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of all.data?.rows ?? []) seen.set(r.projectId, r.projectName);
    return [...seen.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [all.data]);
  // An unknown ?project= is ignored (the filter simply shows everything).
  const projectId = wantedProject && projectOptions.some((o) => o.value === wantedProject) ? wantedProject : null;
  const filtered = useBillingBoard(projectId, projectId !== null);
  const query = projectId ? filtered : all;
  const columns = useMemo(() => groupBoard(query.data?.rows ?? []), [query.data]);
  const total = columns.reduce((n, c) => n + c.cards.length, 0);

  const setProject = (value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set('project', value); else next.delete('project');
    setParams(next, { replace: true });
  };

  return (
    <div className="min-w-0">
      <PageHeader
        title={t('billingBoard.title', 'Billing board')}
        count={query.isSuccess ? total : undefined}
        action={<BillingPlanLink />}
      />
      <div className="mb-4 max-w-sm">
        <Combobox
          label={t('billingBoard.filterProject', 'Project')}
          value={projectId}
          selectedOption={projectOptions.find((o) => o.value === projectId) ?? null}
          onChange={(v) => setProject(v)}
          loadOptions={() => Promise.resolve(projectOptions)}
          placeholder={t('billingBoard.allProjects', 'All projects')}
          noun={t('billingBoard.projectNoun', 'project')}
          clearable
          onClear={() => setProject(null)}
        />
      </div>
      {query.isPending && <ListState variant="loading" shape="cards" rows={3} />}
      {query.isError && <ListState variant="error" onRetry={() => { void query.refetch(); }} title={t('billingBoard.error', 'The billing board could not be loaded')} />}
      {query.isSuccess && columns.length === 0 && (
        <ListState variant="empty" title={t('billingBoard.empty', 'No claims to show')} sub={t('billingBoard.emptySub', 'Claims appear here once they have billing steps.')} />
      )}
      {query.isSuccess && query.data.truncated && (
        <p role="status" data-testid="billing-board-truncated" className="mb-3 text-control text-muted-foreground">
          {t('billingBoard.truncated', { defaultValue: 'Showing the {{count}} oldest. Filter by project to see the rest.', count: BOARD_LIMIT })}
        </p>
      )}
      {query.isSuccess && columns.length > 0 && (
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:overflow-x-auto md:pb-2">
          {columns.map((c) => <Column key={c.key || 'done'} column={c} />)}
        </div>
      )}
      <BillingBoardWorkOrderSteps projectId={projectId} />
    </div>
  );
};

export default BillingBoard;
