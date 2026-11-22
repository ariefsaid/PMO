import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card } from '@/src/components/ui';
import { formatDay } from '@/src/lib/format';
import { WAITING_KIND_META, type DatabaseListedKind } from '@/src/lib/approvals/waitingKinds';
import type { ApprovalPopulationEntry } from '@/src/lib/selectors/approvals';
import type { WaitingDecisionRow } from '@/src/lib/db/waitingDecisions';

/**
 * One inbox section for a kind the database lists (`my_waiting_decisions`): daily reports to validate, work orders to issue,
 * deliveries to confirm, quantity changes, subcontract certificates, equipment plans. A row opens the record, where the
 * decision is made. Renders nothing when nothing of the kind waits for this viewer.
 */
export const WaitingDecisionSection: React.FC<{ kind: DatabaseListedKind; entries: readonly ApprovalPopulationEntry[] }> = ({ kind, entries }) => {
  const { t } = useTranslation();
  const rows = entries.filter((entry) => entry.kind === kind).map((entry) => entry.row as WaitingDecisionRow);
  if (rows.length === 0) return null;
  const meta = WAITING_KIND_META[kind];
  const heading = t(`approvals.waiting.${kind}`, { defaultValue: '{{what}} waiting for you ({{count}})', what: meta.scopeLabel, count: rows.length });
  return (
    <section aria-label={t(meta.scopeKey, meta.scopeLabel)} className="mb-4" data-testid={`approvals-waiting-${kind}`}>
      <h2 className="mb-2 text-control font-semibold text-muted-foreground">{heading}</h2>
      <Card>
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.recordId} className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
              <Link to={meta.href ? meta.href(row.recordId) : '/approvals'} className="min-w-0 break-words font-semibold text-primary-text hover:underline">{row.title}</Link>
              <span className="text-control text-muted-foreground">{t('approvals.waiting.since', 'Waiting since {{date}}', { date: formatDay(row.createdAt) })}</span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
};
