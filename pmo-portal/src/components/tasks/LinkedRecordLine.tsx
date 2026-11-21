/**
 * The record a task follows (#2587, FR-RLT-009/010/015): its type, number and live status, read through the caller's
 * own row security. A record the caller cannot read says so and nothing else — no number, no status. A task the
 * system closed says why. Pure display: the data comes from `taskLinkedRecords` (one read per page).
 */
import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { StatusPill } from '@/src/components/ui';
import { statusLabel, type StatusRecord } from '@/src/lib/status/statusMap';
import { recordPath } from './recordPaths';
import { closedReasonOf, recordLinkOf, type RecordLinkType, type TaskLinkedRecord, type TaskRow } from '@/src/lib/db/tasks';

type LinkCols = Pick<TaskRow, 'procurement_id' | 'expense_claim_id' | 'material_request_id'>;
type CloseCols = Pick<TaskRow, 'closed_by_record_type' | 'closed_by_record_status'>;

const STATUS_RECORD: Record<RecordLinkType, StatusRecord> = {
  procurement: 'procurement',
  expense_claim: 'expense',
  material_request: 'materialRequest',
};

type T = (key: string, defaultValue: string, opts?: Record<string, string>) => string;

/** Static keys (one per member) so the i18n completeness gate sees every one. */
const typeLabels = (t: T): Record<RecordLinkType, string> => ({
  procurement: t('linkedRecord.type.procurement', 'Purchase'),
  expense_claim: t('linkedRecord.type.expense_claim', 'Expense claim'),
  material_request: t('linkedRecord.type.material_request', 'Material request'),
});
const typeLabelsLower = (t: T): Record<RecordLinkType, string> => ({
  procurement: t('linkedRecord.typeLower.procurement', 'purchase'),
  expense_claim: t('linkedRecord.typeLower.expense_claim', 'expense claim'),
  material_request: t('linkedRecord.typeLower.material_request', 'material request'),
});

interface LinkedRecordLineProps {
  task: LinkCols & Partial<CloseCols>;
  /** Absent while the page read is in flight or failed: the line then shows the type only, never a guessed status. */
  linked: TaskLinkedRecord | undefined;
  className?: string;
}

export const LinkedRecordLine: React.FC<LinkedRecordLineProps> = ({ task, linked, className }) => {
  const { t } = useTranslation('tasks');
  const { t: tStatus } = useTranslation('status');
  const link = recordLinkOf(task);
  if (!link) return null;
  const typeLabel = typeLabels(t as T)[link.type];
  const reason = closedReasonOf({ closed_by_record_type: task.closed_by_record_type ?? null, closed_by_record_status: task.closed_by_record_status ?? null });
  const statusRecord = STATUS_RECORD[link.type];

  // FR-RLT-010: unreadable = the type and one sentence. Nothing about the record leaks.
  if (linked && !linked.readable) {
    return <p className={className ?? 'text-sm text-muted-foreground'}>{t('linkedRecord.unreadable', '{{type}} · linked record you cannot view', { type: typeLabel })}</p>;
  }

  return (
    <div role="group" aria-label={t('linkedRecord.region', 'Linked record')} className={className ?? 'flex flex-wrap items-center gap-x-2 gap-y-1 text-sm'}>
      <span className="text-muted-foreground">{typeLabel}</span>
      {linked?.label && linked.recordId ? (
        <Link
          to={recordPath(link.type, linked.recordId)}
          className="font-medium text-primary underline-offset-2 hover:underline"
          aria-label={t('linkedRecord.open', 'Open {{type}} {{label}}', { type: typeLabel, label: linked.label })}
        >
          {linked.label}
        </Link>
      ) : null}
      {linked?.status ? <StatusPill record={statusRecord} state={linked.status} /> : null}
      {reason ? (
        <span className="text-muted-foreground">
          {t('linkedRecord.closedBy', 'Closed automatically: the {{type}} is {{status}}.', {
            type: typeLabelsLower(t as T)[reason.type],
            status: statusLabel(STATUS_RECORD[reason.type], reason.status, tStatus),
          })}
        </span>
      ) : null}
    </div>
  );
};
