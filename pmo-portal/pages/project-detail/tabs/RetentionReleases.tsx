import React, { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { Button, ConfirmDialog } from '@/src/components/ui';
import { DateField } from '@/src/components/ui/DateField';
import { SelectField, TextField } from '@/src/components/ui/FormFields';
import { useRetentionReleases } from '@/src/hooks/useBillingStages';
import { useDocuments } from '@/src/hooks/useDocuments';
import { formatIsoDay, formatTableMoney } from '@/src/lib/format';

export const RetentionReleases: React.FC<{ claimId: string; projectId: string; currency: string; today: string; withdrawn: boolean }> = ({ claimId, projectId, currency, today, withdrawn }) => {
  const { t } = useTranslation('project');
  const may = usePermission();
  const { releases, schedule, release, cancel } = useRetentionReleases(claimId, projectId);
  const documents = useDocuments(projectId);
  const [amount, setAmount] = useState('');
  const [dueOn, setDueOn] = useState(today);
  const [drafts, setDrafts] = useState<Record<string, { releasedOn: string; reference: string; documentId: string }>>({});
  const changeDraft = (id: string, patch: Partial<{ releasedOn: string; reference: string; documentId: string }>) => {
    setDrafts(previous => ({ ...previous, [id]: { ...(previous[id] ?? { releasedOn: today, reference: '', documentId: '' }), ...patch } }));
  };
  const [cancelFor, setCancelFor] = useState<string | null>(null);
  const [recordFor, setRecordFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canManage = !releases.isPending && !releases.isError && may('edit', 'billingStage');
  const canSchedule = canManage && !withdrawn;
  const documentsReady = !documents.isPending && !documents.isError;
  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try { await action(); return true; } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      const message = code === 'retention-exceeded' ? t('projectDetail.billing.releases.exceeded', 'The scheduled releases exceed the retention held.')
        : code === 'invoice-not-submitted' ? t('projectDetail.billing.releases.invoiceRequired', 'Approve the claim invoice before recording a release.')
        : code === 'release-date' ? t('projectDetail.billing.releases.invalidDate', 'Use a release date from the invoice date through today.')
        : code === 'document-not-issued' || code === 'document-other-project' || code === 'document-without-file' ? t('projectDetail.billing.releases.invalidProof', 'Choose an issued or approved project document with a file.')
        : t('projectDetail.billing.releases.error', 'Could not save the release. Check the amount, date and invoice status, then try again.');
      setError(message); return false;
    }
  };
  const pendingRecord = releases.data?.find(row => row.id === recordFor);
  const pendingDraft = recordFor ? (drafts[recordFor] ?? { releasedOn: today, reference: '', documentId: '' }) : null;
  const eligible = (documents.data ?? []).filter(d => (d.status === 'Issued' || d.status === 'Approved') && Boolean(d.file_path));
  return <section className="mt-4 border-t border-border pt-4" aria-label={t('projectDetail.billing.releases.title', 'Retention releases')}>
    <h4 className="font-semibold">{t('projectDetail.billing.releases.title', 'Retention releases')}</h4>
    {releases.isPending ? <p>{t('projectDetail.billing.releases.loading', 'Loading releases…')}</p> : releases.isError ? <div role="alert"><p>{t('projectDetail.billing.releases.loadError', 'Releases could not be loaded.')}</p><Button variant="outline" size="sm" onClick={() => void releases.refetch()}>{t('projectDetail.billing.stages.retry', 'Retry')}</Button></div>
      : !releases.data?.length ? <p className="mt-2 text-sm text-muted-foreground">{t('projectDetail.billing.releases.empty', 'No releases scheduled.')}</p>
      : <ul className="mt-2 divide-y divide-border">{releases.data.map(row => { const draft = drafts[row.id] ?? { releasedOn: today, reference: '', documentId: '' }; return <li key={row.id} className="space-y-2 py-3 text-sm">
        <p>{formatTableMoney(row.amount, currency)} · {t('projectDetail.billing.releases.due', 'Due {{date}}', { date: formatIsoDay(row.dueOn) })}
          {row.releasedOn && <> · {t('projectDetail.billing.releases.recorded', 'Released {{date}}', { date: formatIsoDay(row.releasedOn) })}</>}</p>
        {row.referenceNo && <p>{row.referenceNo}</p>}
        {row.documentId && <Link className="font-medium text-primary-text hover:underline" to={`/projects/${encodeURIComponent(projectId)}/documents?open=${encodeURIComponent(row.documentId)}`}>{(documents.data ?? []).find(d => d.id === row.documentId)?.title ?? t('projectDetail.billing.evidence.document', 'Evidence document')}</Link>}
        {!row.releasedOn && canManage && <div className="flex flex-wrap items-end gap-2">
          {!withdrawn && <>
          <DateField compact label={t('projectDetail.billing.releases.releaseDate', 'Release date')} value={draft.releasedOn} max={today} onChange={value => changeDraft(row.id, { releasedOn: value })} />
          <TextField label={t('projectDetail.billing.releases.reference', 'Reference (optional)')} value={draft.reference} onChange={value => changeDraft(row.id, { reference: value })} />
          <SelectField compact disabled={!documentsReady} label={t('projectDetail.billing.releases.proof', 'Proof document (optional)')} value={draft.documentId} onChange={value => changeDraft(row.id, { documentId: value })} placeholder={t('projectDetail.billing.releases.noProof', 'No document')} options={eligible.map(d => ({ value: d.id, label: d.title ?? d.id }))} />
          <Button variant="primary" size="sm" disabled={release.isPending || !draft.releasedOn || !documentsReady} onClick={() => { setError(null); setRecordFor(row.id); }}>{t('projectDetail.billing.releases.record', 'Record release')}</Button>
          </>}
          <Button variant="outline" size="sm" disabled={cancel.isPending || release.isPending} onClick={() => { setError(null); setCancelFor(row.id); }}>{t('projectDetail.billing.releases.cancel', 'Cancel release')}</Button>
        </div>}
      </li>; })}</ul>}
    {canSchedule && releases.data?.some(row => !row.releasedOn) && documents.isPending && <p role="status" className="text-sm text-muted-foreground">{t('projectDetail.billing.releases.documentsLoading', 'Loading proof documents…')}</p>}
    {canSchedule && releases.data?.some(row => !row.releasedOn) && documents.isError && <div role="alert" className="text-sm"><p>{t('projectDetail.billing.releases.documentsError', 'Proof documents could not be loaded.')}</p><Button variant="outline" size="sm" onClick={() => void documents.refetch()}>{t('projectDetail.billing.releases.retryDocuments', 'Retry documents')}</Button></div>}
    {canSchedule && <div className="mt-3 flex flex-wrap items-end gap-2">
      <TextField label={t('projectDetail.billing.releases.amount', 'Amount')} inputMode="decimal" value={amount} onChange={setAmount} />
      <DateField compact label={t('projectDetail.billing.releases.dueDate', 'Due date')} value={dueOn} onChange={setDueOn} />
      <Button variant="outline" size="sm" disabled={schedule.isPending || !dueOn || !/^\d+(?:[.,]\d{1,2})?$/.test(amount) || Number(amount.replace(',', '.')) <= 0} onClick={() => void run(() => schedule.mutateAsync({ claimId, amount: Number(amount.replace(',', '.')), dueOn, note: null })).then(ok => { if (ok) setAmount(''); })}>{t('projectDetail.billing.releases.schedule', 'Schedule release')}</Button>
    </div>}
    {error && !recordFor && !cancelFor && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    {pendingRecord && pendingDraft && <ConfirmDialog open title={t('projectDetail.billing.releases.recordTitle', 'Record this release?')} description={t('projectDetail.billing.releases.recordDescription', 'Record {{amount}} as released on {{date}}. This record cannot be changed later.', { amount: formatTableMoney(pendingRecord.amount, currency) ?? '', date: formatIsoDay(pendingDraft.releasedOn) })} confirmLabel={t('projectDetail.billing.releases.confirmRecord', 'Confirm release')} confirmDisabled={!documentsReady} error={error} loading={release.isPending} onConfirm={() => void run(() => release.mutateAsync({ releaseId: pendingRecord.id, releasedOn: pendingDraft.releasedOn, reference: pendingDraft.reference.trim() || null, documentId: pendingDraft.documentId || null })).then(ok => { if (ok) setRecordFor(null); })} onCancel={() => setRecordFor(null)} />}
    {cancelFor && <ConfirmDialog open tone="destructive" title={t('projectDetail.billing.releases.cancelTitle', 'Cancel this release?')} error={error} description={t('projectDetail.billing.releases.cancelDescription', 'The scheduled release will be removed.')} confirmLabel={t('projectDetail.billing.releases.confirmCancel', 'Confirm cancellation')} onConfirm={() => void run(() => cancel.mutateAsync(cancelFor)).then(ok => { if (ok) setCancelFor(null); })} onCancel={() => setCancelFor(null)} loading={cancel.isPending} />}
  </section>;
};
