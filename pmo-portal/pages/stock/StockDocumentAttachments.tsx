import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, TextField } from '@/src/components/ui';
import { useAssignableProfiles } from '@/src/hooks/useTasks';
import { formatDateTime } from '@/src/lib/format';
import { FileInput } from '@/src/components/ui/FormFields';
import { stockSiteWorkRepository } from '@/src/lib/repositories/stockSiteWork';

export function StockDocumentAttachments({ orgId, documentId, canWrite, status }: { orgId: string; documentId: string; canWrite: boolean; status: string }) {
  const { t } = useTranslation('stock');
  const qc = useQueryClient();
  const profiles = useAssignableProfiles();
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState('');
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(false);
  const key = ['stock-document-files', orgId, documentId];
  const query = useQuery({ queryKey: key, queryFn: () => stockSiteWorkRepository.files.list(documentId) });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: ['stock-proof-status'] })]);
  const upload = useMutation({ mutationFn: () => stockSiteWorkRepository.files.upload(orgId, documentId, file!, label.trim() || null), onSuccess: async () => { setFile(null); setLabel(''); setError(false); await refresh(); }, onError: () => setError(true) });
  const change = useMutation({ mutationFn: ({ id, archive, filePath }: { id: string; archive: boolean; filePath: string }) => archive ? stockSiteWorkRepository.files.archive(id, reason) : stockSiteWorkRepository.files.remove(id, filePath), onSuccess: async () => { setReasonFor(null); setReason(''); setError(false); await refresh(); }, onError: () => setError(true) });
  const download = async (path: string) => { try { const url = await stockSiteWorkRepository.files.download(path); window.open(url, '_blank', 'noopener,noreferrer'); } catch { setError(true); } };
  return <section className="space-y-3 rounded-lg border border-border p-4" aria-label={t('siteWork.files.title')}>
    {query.isPending ? <p>{t('siteWork.files.loading')}</p> : query.isError ? <p role="alert">{t('siteWork.files.loadError')}</p> : <ul className="space-y-2">{(query.data ?? []).map((f) => <li key={f.id} className="flex flex-wrap items-center gap-2">
      <Button variant="ghost" size="sm" onClick={() => void download(f.file_path)}>{f.label || f.file_path.split('/').pop()}</Button>
      <span className="text-sm text-muted-foreground">{profiles.data?.find((p) => p.id === f.uploaded_by)?.full_name || t('siteWork.files.unknownUploader')} · {formatDateTime(new Date(f.created_at))}</span>
      {f.archived_at && <span>{t('setup.archivedBadge')}</span>}
      {canWrite && !f.archived_at && reasonFor !== f.id && <Button variant="ghost" size="sm" onClick={() => status === 'Draft' ? change.mutate({ id: f.id, archive: false, filePath: f.file_path }) : setReasonFor(f.id)}>{status === 'Draft' ? t('siteWork.files.remove') : t('setup.actions.archive')}</Button>}
      {reasonFor === f.id && <form onSubmit={(e) => { e.preventDefault(); if (reason.trim()) change.mutate({ id: f.id, archive: true, filePath: f.file_path }); }}><TextField id={`archive-${f.id}`} label={t('siteWork.files.reason')} value={reason} onChange={setReason} required /><Button variant="primary" type="submit" disabled={!reason.trim() || change.isPending}>{t('setup.actions.archive')}</Button></form>}
    </li>)}</ul>}
    {error && <p role="alert">{t('siteWork.files.error')}</p>}
    {canWrite && <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (file) upload.mutate(); }}>
      <label htmlFor="stock-attachment" className="block text-sm">{t('siteWork.files.choose')}</label>
      <FileInput id="stock-attachment" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)} />
      <TextField id="stock-attachment-label" label={t('siteWork.files.label')} value={label} onChange={setLabel} />
      <Button variant="primary" type="submit" disabled={!file || upload.isPending}>{t('siteWork.files.upload')}</Button>
    </form>}
  </section>;
}
