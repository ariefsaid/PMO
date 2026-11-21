import React, { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui/Button';
import { DateField } from '@/src/components/ui/DateField';
import { SelectField } from '@/src/components/ui/FormFields';
import { ListState, RecordSection, StatusPill } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useCloseoutItemMutations, useWorkOrderCloseoutItems } from '@/src/hooks/useCloseoutChecklist';
import { useDocuments } from '@/src/hooks/useDocuments';
import { closeoutItemAgeDays, closeoutRemaining, currentCloseoutIndex } from '@/src/lib/closeoutChecklist';
import { formatIsoDay, formatNumberExact } from '@/src/lib/format';
import { localToday } from '@/src/lib/efaktur';

/**
 * The work order's close-out checklist (#2593, FR-WCO-010..013, 020): the organisation's ordered list as it stood when this
 * work order was issued, each item needing an attached document. The database decides (order, document, dates, who may record)
 * and refuses to close the work order while a required item is open. Nothing shows for a work order that has no checklist.
 * The item names are the organisation's own data: this component knows none of them.
 */
export interface CloseoutSectionProps {
  workOrderId: string;
  projectId: string;
  /** Items change only while the work order is Issued. */
  status: string;
  /** The organisation's calendar day; the server re-checks dates on its own calendar. */
  today?: string;
}

const REFUSALS: Record<string, [string, string]> = {
  'item-out-of-order': ['refusal.outOfOrder', 'Complete the earlier items first.'],
  'item-document-missing': ['refusal.documentMissing', 'Attach a document before marking this item done.'],
  'item-date-invalid': ['refusal.dateInvalid', 'Use a date that is not in the future and not before the previous item.'],
  'item-document-invalid': ['refusal.documentInvalid', "Choose an issued or approved document with a file from this work order's project."],
  'item-already-done': ['refusal.alreadyDone', 'This item is already done.'],
  'work-order-not-issued': ['refusal.notIssued', 'Items can be recorded only while the work order is issued.'],
};

export const CloseoutSection: React.FC<CloseoutSectionProps> = ({ workOrderId, projectId, status, today = localToday() }) => {
  const { t } = useTranslation('closeout');
  const may = usePermission();
  const query = useWorkOrderCloseoutItems(workOrderId);
  const documents = useDocuments(projectId);
  const { attachDocument, completeItem } = useCloseoutItemMutations(workOrderId);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [doneOn, setDoneOn] = useState(today);
  const [refusal, setRefusal] = useState<string | null>(null);

  const title = t('title', 'Close-out checklist');
  if (query.isError) {
    return <RecordSection title={title}>
      <ListState variant="error" title={t('loadError', "Couldn't load the close-out checklist")} onRetry={() => void query.refetch()} />
    </RecordSection>;
  }
  const items = query.data;
  if (!items || items.length === 0) return null;

  const canRecord = status === 'Issued' && may('transition', 'closeoutItem');
  const current = currentCloseoutIndex(items);
  const remaining = closeoutRemaining(items);
  const eligible = (documents.data ?? []).filter((d) => (d.status === 'Issued' || d.status === 'Approved') && Boolean(d.file_path));
  const titleOf = (id: string) => (documents.data ?? []).find((d) => d.id === id)?.title ?? t('document', 'Document');

  const explain = (err: unknown) => {
    const code = (err as { code?: string } | null)?.code ?? '';
    const known = REFUSALS[code];
    setRefusal(known ? t(known[0], known[1]) : t('refusal.generic', 'The item could not be saved. Try again.'));
  };
  const attach = async (itemId: string) => {
    const documentId = picked[itemId];
    if (!documentId) return;
    setRefusal(null);
    try { await attachDocument.mutateAsync({ itemId, documentId }); } catch (err) { explain(err); }
  };
  const complete = async (itemId: string) => {
    setRefusal(null);
    try { await completeItem.mutateAsync({ itemId, doneOn }); } catch (err) { explain(err); }
  };

  return <RecordSection title={title}>
    <p className="text-control text-muted-foreground" data-testid="closeout-summary">
      {remaining > 0
        ? t('remaining', 'Required items not done: {{count}}. This work order closes only when every required item is done.', { count: remaining })
        : t('complete', 'Every required item is done. This work order can be closed.')}
    </p>
    {refusal && <p role="alert" className="mt-2 text-control text-destructive">{refusal}</p>}
    <ol aria-label={title} className="mt-3 divide-y divide-border" data-testid="closeout-items">
      {items.map((item, index) => {
        const age = closeoutItemAgeDays(item, today);
        const isCurrent = index === current;
        return <li key={item.id} aria-label={item.name} className="py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">
              <span className="mr-2 tabular-nums text-muted-foreground">{formatNumberExact(item.position)}</span>{item.name}
              <span className="ml-2 text-control font-normal text-muted-foreground">{item.required ? t('required', 'required') : t('optional', 'optional')}</span>
            </span>
            <span className="flex items-center gap-2 text-control">
              {age !== null && <span className="tabular-nums text-muted-foreground">{t('age', '{{count}} days', { count: age })}</span>}
              <StatusPill variant={item.doneOn ? 'won' : isCurrent ? 'progress' : 'neutral'} wrap={false}>
                {item.doneOn
                  ? t('done', 'Done {{date}}', { date: formatIsoDay(item.doneOn) })
                  : isCurrent ? t('current', 'Current') : t('waiting', 'Waiting')}
              </StatusPill>
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-control">
            {item.documentId
              ? <Link to={`/projects/${encodeURIComponent(projectId)}/documents?open=${encodeURIComponent(item.documentId)}`}
                  className="font-medium text-primary-text hover:underline">{titleOf(item.documentId)}</Link>
              : canRecord && !item.doneOn
                ? <span className="flex items-center gap-2">
                    <SelectField compact inline hideLabel
                      label={t('pickFor', 'Document for {{item}}', { item: item.name })}
                      placeholder={t('pick', 'Choose a document')}
                      value={picked[item.id] ?? ''}
                      onChange={(v) => setPicked((p) => ({ ...p, [item.id]: v }))}
                      options={eligible.map((d) => ({ value: d.id, label: d.title ?? d.id }))} />
                    <Button variant="outline" size="sm" disabled={!picked[item.id] || attachDocument.isPending}
                      aria-label={t('attachTo', 'Attach to {{item}}', { item: item.name })}
                      onClick={() => void attach(item.id)}>{t('attach', 'Attach')}</Button>
                  </span>
                : <span className="text-muted-foreground">{t('notAttached', 'No document attached')}</span>}
            {item.doneOn && item.doneByName && <span className="text-muted-foreground">{t('doneBy', 'Marked done by {{name}}', { name: item.doneByName })}</span>}
          </div>
          {isCurrent && canRecord && item.documentId && <div className="mt-3 flex flex-wrap items-end gap-3">
            <DateField compact label={t('doneOn', 'Done on')} value={doneOn} max={today} onChange={setDoneOn} />
            <Button variant="primary" size="sm" disabled={completeItem.isPending}
              aria-label={t('markDoneNamed', 'Mark {{item}} done', { item: item.name })}
              onClick={() => void complete(item.id)}>{t('markDone', 'Mark done')}</Button>
          </div>}
        </li>;
      })}
    </ol>
  </RecordSection>;
};

export default CloseoutSection;
