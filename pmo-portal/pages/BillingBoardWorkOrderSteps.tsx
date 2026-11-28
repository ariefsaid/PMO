import React, { useContext, useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '@/src/auth/AuthContext';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { useBoardWorkOrderSteps } from '@/src/hooks/useBillingSteps';
import { useBuiltInRoleName } from '@/src/hooks/useOrgRoleNames';
import { orgDayNow } from '@/src/hooks/useOrgToday';
import { stepDaysOver, stepStatus } from '@/src/lib/workOrderBillingSteps';
import type { BoardWorkOrderStep } from '@/src/lib/db/workOrderBillingSteps';

/**
 * The work orders' billing steps on the billing board (billing-steps.spec.md FR-WBS-009): the same rows as the work-order page, grouped by
 * work order, one line per step. A read-only view; a step is acted on from its work order. Advisory: the claim columns above it are what
 * gate invoicing. Shows nothing while there is nothing to show (an organisation with no default billing step template sees the board as before).
 */
const Body: React.FC<{ projectId: string | null }> = ({ projectId }) => {
  const { t } = useTranslation('billingSteps');
  const roleName = useBuiltInRoleName();
  const query = useBoardWorkOrderSteps(projectId ?? undefined);
  const today = orgDayNow();
  const groups = useMemo(() => {
    const byWo = new Map<string, BoardWorkOrderStep[]>();
    for (const s of query.data ?? []) byWo.set(s.workOrderId, [...(byWo.get(s.workOrderId) ?? []), s]);
    return [...byWo.entries()].map(([id, steps]) => ({ id, steps: steps.sort((a, b) => a.position - b.position) }));
  }, [query.data]);
  if (query.isError) return <p role="status" className="mt-6 text-control text-muted-foreground">{t('boardError', 'The work-order billing steps could not be loaded.')}</p>;
  if (groups.length === 0) return null;
  return <section aria-label={t('boardTitle', 'Work-order billing steps')} className="mt-8" data-testid="billing-board-wo-steps">
    <h2 className="mb-2 text-[14px] font-semibold">{t('boardTitle', 'Work-order billing steps')}</h2>
    <ul className="grid gap-3 md:grid-cols-2">
      {groups.map(({ id, steps }) => {
        const first = steps[0];
        return <li key={id} className="rounded-md border border-border bg-card p-3 text-control">
          <Link to={`/work-orders/${encodeURIComponent(id)}`} className="block min-h-11 font-medium text-primary-text hover:underline">
            {t('boardWorkOrder', 'Work order {{label}}', { label: first.workOrderLabel })}
            <span className="ml-2 font-normal text-muted-foreground">{first.projectName}</span>
          </Link>
          <ol className="mt-2 space-y-1" aria-label={first.workOrderLabel}>
            {steps.map((s) => {
              const status = stepStatus(s);
              const over = stepDaysOver(s, today);
              return <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  <span className="mr-2 tabular-nums text-muted-foreground">{s.position}</span>{s.name}
                  {status === 'current' && <span className="ml-2 text-muted-foreground">{s.assigneeName ?? (s.ownerRoleKey ? roleName(s.ownerRoleKey) : '')}</span>}
                </span>
                <span className="flex items-center gap-2">
                  {over !== null && <StatusPill variant="overdue" wrap={false}>{t('over', '{{count}} days past target', { count: over })}</StatusPill>}
                  <StatusPill variant={status === 'done' ? 'won' : status === 'current' ? 'progress' : 'neutral'} wrap={false}>
                    {status === 'done' ? t('doneShort', 'Done') : status === 'skipped' ? t('skippedShort', 'Skipped') : status === 'current' ? t('current', 'Current') : t('waiting', 'Not yet open')}
                  </StatusPill>
                </span>
              </li>;
            })}
          </ol>
        </li>;
      })}
    </ul>
  </section>;
};

export const BillingBoardWorkOrderSteps: React.FC<{ projectId: string | null }> = ({ projectId }) => {
  const auth = useContext(AuthContext);
  if (!auth) return null;
  return <Body projectId={projectId} />;
};

export default BillingBoardWorkOrderSteps;
