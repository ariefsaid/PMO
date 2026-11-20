import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, ConfirmDialog, TextField } from '@/src/components/ui';
import { useStockErrorText } from '@/src/components/stock/useStockErrorText';
import { useStockTags } from '@/src/hooks/useStockSiteWork';
import { stockSiteWorkRepository, type StockTagRow } from '@/src/lib/repositories/stockSiteWork';

export function StockTagsPanel() {
  const { t } = useTranslation('stock');
  const query = useStockTags(true);
  const errorText = useStockErrorText();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<StockTagRow | null>(null);
  const [name, setName] = useState('');
  const [zeroCost, setZeroCost] = useState(false);
  const [paperRequired, setPaperRequired] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<StockTagRow | null>(null);
  const [error, setError] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['stock-tags'] });
  const save = useMutation({ mutationFn: async () => {
    const input = { name: name.trim(), zeroCost, paperRequired: zeroCost && paperRequired };
    if (editing) await stockSiteWorkRepository.tags.update(editing.id, input);
    else await stockSiteWorkRepository.tags.create(input);
  }, onSuccess: async () => { setEditing(null); setName(''); setZeroCost(false); setPaperRequired(false); setError(''); await refresh(); }, onError: (err) => setError(errorText(err)) });
  const archive = useMutation({ mutationFn: ({ id, archived }: { id: string; archived: boolean }) => stockSiteWorkRepository.tags.archive(id, archived), onSuccess: async () => { setArchiveTarget(null); await refresh(); }, onError: (err) => setError(errorText(err)) });
  const startEdit = (tag: StockTagRow) => { setEditing(tag); setName(tag.name); setZeroCost(tag.zero_cost); setPaperRequired(tag.paper_required); };
  return <section className="space-y-3 rounded-lg border border-border p-4" aria-label={t('siteWork.tags.manage')}>
    {query.isError ? <p role="alert">{t('siteWork.tags.loadError')}</p> : query.isPending ? <p>{t('siteWork.tags.loading')}</p> :
      <ul className="space-y-2">{(query.data ?? []).map((tag) => <li key={tag.id} className="flex flex-wrap items-center gap-2">
        <span>{tag.name}{tag.archived_at ? ` · ${t('setup.archivedBadge')}` : ''}</span>
        <Button variant="ghost" size="sm" onClick={() => startEdit(tag)}>{t('setup.actions.edit')}</Button>
        <Button variant="ghost" size="sm" disabled={archive.isPending} onClick={() => tag.archived_at ? archive.mutate({ id: tag.id, archived: false }) : setArchiveTarget(tag)}>{tag.archived_at ? t('setup.actions.restore') : t('setup.actions.archive')}</Button>
      </li>)}</ul>}
    <ConfirmDialog open={!!archiveTarget} title={t('siteWork.tags.confirmTitle')} description={t('siteWork.tags.confirmDescription')} confirmLabel={t('setup.actions.archive')} loading={archive.isPending} onConfirm={() => { if (archiveTarget) archive.mutate({ id: archiveTarget.id, archived: true }); }} onCancel={() => setArchiveTarget(null)} />
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate(); }}>
      <TextField id="stock-tag-name" label={t('siteWork.tags.name')} value={name} onChange={setName} required />
      <Checkbox label={t('siteWork.tags.zero')} checked={zeroCost} onChange={setZeroCost}>{t('siteWork.tags.zero')}</Checkbox>
      {zeroCost && <Checkbox label={t('siteWork.tags.paper')} checked={paperRequired} onChange={setPaperRequired}>{t('siteWork.tags.paper')}</Checkbox>}
      {error && <p role="alert">{error}</p>}
      <Button variant="primary" type="submit" disabled={!name.trim() || save.isPending}>{editing ? t('siteWork.tags.save') : t('siteWork.tags.add')}</Button>
      {editing && <Button variant="ghost" onClick={() => { setEditing(null); setName(''); setZeroCost(false); setPaperRequired(false); }}>{t('actions.cancel')}</Button>}
    </form>
  </section>;
}
