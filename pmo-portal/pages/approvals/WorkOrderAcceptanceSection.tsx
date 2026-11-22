import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card } from '@/src/components/ui';
import { formatDay } from '@/src/lib/format';
import { scopeLabelText, waitingHeadingText } from '@/src/lib/approvals/waitingKinds';
import type { ApprovalPopulationEntry } from '@/src/lib/selectors/approvals';
import type { AcceptanceAwaitingConfirmationRow } from '@/src/lib/db/workOrderAcceptances';

/**
 * The client acceptances (BAST) waiting for THIS viewer to confirm, in their own inbox section. These rows come from
 * the caller-filtered database read `acceptances_awaiting_my_confirmation` (1570), NOT from `my_waiting_decisions`
 * and not from the `delivery_record` kind (a purchase receipt). The row opens its WORK ORDER — the acceptance itself
 * has no page, and its id is never substituted for the order id. Renders nothing when none waits for this viewer.
 */
export const WorkOrderAcceptanceSection: React.FC<{ entries: readonly ApprovalPopulationEntry[] }> = ({ entries }) => {
  const { t } = useTranslation();
  const translate = (key: string, fallback: string, options?: Record<string, unknown>) =>
    t(key, { defaultValue: fallback, ...(options ?? {}) });
  const rows = entries
    .filter((entry) => entry.kind === 'work_order_acceptance')
    .map((entry) => entry.row as AcceptanceAwaitingConfirmationRow);
  if (rows.length === 0) return null;
  return (
    <section
      aria-label={scopeLabelText('work_order_acceptance', translate)}
      className="mb-4"
      data-testid="approvals-waiting-work_order_acceptance"
    >
      <h2 className="mb-2 text-control font-semibold text-muted-foreground">
        {waitingHeadingText('work_order_acceptance', rows.length, translate)}
      </h2>
      <Card>
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
              <Link to={`/work-orders/${row.work_order_id}`} className="min-w-0 break-words font-semibold text-primary-text hover:underline">
                {t('waitingList:bast.row', 'Client acceptance ({{kind}}) of {{date}}', {
                  kind: row.is_final ? t('waitingList:bast.final', 'final') : t('waitingList:bast.stage', 'stage'),
                  date: formatDay(row.acceptance_date),
                })}
              </Link>
              <span className="text-control text-muted-foreground">
                {t('waitingList:since', 'Waiting since {{date}}', { date: formatDay(row.prepared_at) })}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
};
