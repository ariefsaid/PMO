import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, FieldError, ListState, TextField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useCheckpointList, useSetCheckpointList } from '@/src/hooks/useSiteCheckpoints';
import { draftsToItems, toDraft, type Draft } from './siteCheckpointDraft';

const MAX = 12;

/**
 * Administration › Projects › Day checkpoints (#2594, FR-STC-001/052): the organisation's own list of timed checkpoints, in the
 * order of the day. Nothing is built in; an empty list means no checkpoints are created and nobody is reminded. Admin only
 * (`can('manage', 'siteCheckpointList')` is UX; `set_site_checkpoint_list` is the authority, ADR-0016). Saving replaces the
 * whole list and never changes a checkpoint already created for a day.
 */
const SiteCheckpointTemplate: React.FC = () => {
  const { t } = useTranslation('administration');
  const { toast } = useToast();
  const may = usePermission();
  const allowed = may('manage', 'siteCheckpointList');
  const query = useCheckpointList(allowed);
  const save = useSetCheckpointList();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<string>();
  const [dirty, setDirty] = useState(false);

  useEffect(() => { if (query.data && !dirty) setDrafts(query.data.map(toDraft)); }, [query.data, dirty]);
  if (!allowed) return null;

  const edit = (index: number, patch: Partial<Draft>) => {
    setDirty(true);
    setDrafts((rows) => rows.map((r, i) => {
      if (i === index) return { ...r, ...patch };
      return patch.start ? { ...r, start: false } : r;
    }));
  };
  const move = (index: number, by: -1 | 1) => {
    setDirty(true);
    setDrafts((rows) => {
      const next = [...rows]; const j = index + by;
      if (j < 0 || j >= next.length) return rows;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };
  const onSave = async () => {
    setError(undefined);
    const result = draftsToItems(drafts);
    if ('error' in result) { setError(t(`admin.siteCheckpoints.invalid.${result.error}`, 'Check the checkpoints')); return; }
    try {
      await save.mutateAsync(result.items);
      setDirty(false);
      toast(t('admin.siteCheckpoints.saved', 'Checkpoints saved'), undefined, 'success');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setError(detail || headline);
    }
  };

  return (
    <section id="site-checkpoints" tabIndex={-1} className="scroll-mt-4" aria-labelledby="site-checkpoints-heading">
      <h2 id="site-checkpoints-heading" className="text-group font-semibold tracking-[-0.01em]">{t('admin.siteCheckpoints.title', 'Day checkpoints')}</h2>
      <p className="mt-1 max-w-prose text-control text-muted-foreground">
        {t('admin.siteCheckpoints.helper', 'The checkpoints of a working day, with the time each is due. The field controller records each with a photo; a late one reminds the reporter and flags the work order. With no checkpoints, nothing is created or reminded.')}
      </p>
      <div className="mt-4 space-y-3">
        {error && <FieldError id="site-checkpoints-error">{error}</FieldError>}
        {query.isError && !query.data ? (
          <ListState variant="error" title={t('admin.siteCheckpoints.loadError', "Couldn't load the checkpoints")} onRetry={() => void query.refetch()} />
        ) : !query.data ? (
          <ListState variant="loading" rows={3} />
        ) : (
          <>
            {drafts.length === 0 && <p className="text-control text-muted-foreground">{t('admin.siteCheckpoints.empty', 'No checkpoints yet. Nothing is created or reminded until you add one.')}</p>}
            <ol className="space-y-3">
              {drafts.map((d, i) => (
                <li key={i} className="rounded-md border border-border p-3" data-testid={`checkpoint-item-${i}`}>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_8rem]">
                    <TextField label={t('admin.siteCheckpoints.name', 'Name')} value={d.name} maxLength={120} onChange={(v) => edit(i, { name: v })} />
                    <TextField label={t('admin.siteCheckpoints.time', 'Due time')} type="time" value={d.time} onChange={(v) => edit(i, { time: v })} />
                    <TextField label={t('admin.siteCheckpoints.grace', 'Grace (minutes)')} inputMode="numeric" value={d.grace} onChange={(v) => edit(i, { grace: v })} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
                    <Checkbox checked={d.photo} onChange={(v) => edit(i, { photo: v })} label={t('admin.siteCheckpoints.photoLabel', 'Photo required for {{name}}', { name: d.name || String(i + 1) })}>
                      {t('admin.siteCheckpoints.photo', 'Photo required')}
                    </Checkbox>
                    <Checkbox checked={d.start} onChange={(v) => edit(i, { start: v })} label={t('admin.siteCheckpoints.startLabel', 'Marks the start of work for {{name}}', { name: d.name || String(i + 1) })}>
                      {t('admin.siteCheckpoints.start', 'Marks the start of work')}
                    </Checkbox>
                    <span className="ml-auto flex gap-2">
                      <Button variant="outline" size="sm" disabled={i === 0} aria-label={t('admin.siteCheckpoints.up', 'Move up')} onClick={() => move(i, -1)}>{t('admin.siteCheckpoints.up', 'Move up')}</Button>
                      <Button variant="outline" size="sm" disabled={i === drafts.length - 1} aria-label={t('admin.siteCheckpoints.down', 'Move down')} onClick={() => move(i, 1)}>{t('admin.siteCheckpoints.down', 'Move down')}</Button>
                      <Button variant="outline" size="sm" onClick={() => { setDirty(true); setDrafts((rows) => rows.filter((_, j) => j !== i)); }}>{t('admin.siteCheckpoints.remove', 'Remove')}</Button>
                    </span>
                  </div>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={drafts.length >= MAX}
                onClick={() => { setDirty(true); setDrafts((rows) => [...rows, { name: '', time: '', grace: '0', photo: true, start: false }]); }}>
                {t('admin.siteCheckpoints.add', 'Add checkpoint')}
              </Button>
              <Button variant="primary" onClick={() => void onSave()} loading={save.isPending} disabled={!dirty}>{t('admin.siteCheckpoints.save', 'Save checkpoints')}</Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
};

export default SiteCheckpointTemplate;
