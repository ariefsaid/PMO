import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, FieldError, ListState, TextField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useCandidateTemplate, useSaveCandidateTemplate } from '@/src/hooks/useWorkOrderCandidates';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

/**
 * Administration › Projects › Assessment checklist for candidate work orders (#2595, FR-CWO-007/008, migration 1406): the
 * checks the organisation wants made before it accepts a candidate. An Admin edits the whole ordered list and saves it once.
 * Nothing is supplied by the system: the list starts empty. A saved change reaches only candidates opened afterwards; a
 * candidate already open keeps its own copy. Admin-only via `can('manage', 'workOrderCandidateTemplate')` (UX); the RPC decides.
 */
interface Row { key: string; id: string | null; label: string; required: boolean }
const MAX_ITEMS = 50;
let nextKey = 0;
const fresh = (label = '', required = true): Row => ({ key: `new-${nextKey++}`, id: null, label, required });

const WorkOrderCandidateTemplate: React.FC = () => {
  const { t } = useTranslation('administration');
  const { toast } = useToast();
  const may = usePermission();
  const query = useCandidateTemplate();
  const save = useSaveCandidateTemplate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (query.data && rows === null) setRows(query.data.map((i) => ({ key: i.id, id: i.id, label: i.label, required: i.required })));
  }, [query.data, rows]);

  if (!may('manage', 'workOrderCandidateTemplate')) return null;

  const live = rows ?? [];
  const dirty = JSON.stringify(live.map((r) => [r.id, r.label.trim(), r.required])) !== JSON.stringify((query.data ?? []).map((i) => [i.id, i.label, i.required]));
  const blank = live.some((r) => !r.label.trim());
  const patch = (key: string, p: Partial<Row>) => setRows(live.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...live];
    const [row] = next.splice(index, 1);
    next.splice(index + by, 0, row);
    setRows(next);
  };

  const onSave = async () => {
    setError(undefined);
    try {
      await save.mutateAsync(live.map((r) => ({ id: r.id, label: r.label, required: r.required })));
      setRows(null);
      toast(t('admin.candidateTemplate.saved', 'Checklist saved'), undefined, 'success');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setError(detail || headline);
    }
  };

  return (
    <section id="candidate-checklist" tabIndex={-1} className="scroll-mt-4" aria-labelledby="candidate-checklist-heading">
      <h2 id="candidate-checklist-heading" className="text-group font-semibold tracking-[-0.01em]">{t('admin.candidateTemplate.title', 'Candidate work order checklist')}</h2>
      <p className="mt-1 max-w-prose text-control text-muted-foreground">
        {t('admin.candidateTemplate.helper', 'The checks to make before a candidate work order is accepted. A candidate copies this list when it is opened, so later changes do not alter candidates already open.')}
      </p>
      <div className="mt-4 max-w-2xl space-y-3">
        {error && <FieldError id="candidate-checklist-error">{error}</FieldError>}
        {query.isError && !query.data ? (
          <ListState variant="error" title={t('admin.candidateTemplate.loadError', "Couldn't load the checklist")} onRetry={() => void query.refetch()} />
        ) : rows === null ? (
          <ListState variant="loading" rows={2} />
        ) : (
          <>
            {live.length === 0 && <p className="text-control text-muted-foreground">{t('admin.candidateTemplate.empty', 'No checks yet. Without any, a candidate can be accepted straight away.')}</p>}
            <ol className="space-y-2">
              {live.map((r, i) => (
                <li key={r.key} className="flex flex-wrap items-end gap-2 sm:flex-nowrap">
                  <span className="w-6 shrink-0 pb-2 text-control text-muted-foreground" aria-hidden="true">{i + 1}.</span>
                  <TextField wrapperClassName="min-w-0 flex-1 basis-[calc(100%-2rem)] sm:basis-0" label={t('admin.candidateTemplate.itemLabel', 'Check {{n}}', { n: i + 1 })} hideLabel value={r.label} maxLength={200}
                    onChange={(v) => patch(r.key, { label: v })} />
                  <span className="flex items-center gap-2 pb-2 text-control">
                    <Checkbox checked={r.required} label={t('admin.candidateTemplate.requiredFor', 'Required: {{name}}', { name: r.label || i + 1 })} onChange={(v) => patch(r.key, { required: v })} />
                    {t('admin.candidateTemplate.required', 'Required')}
                  </span>
                  <span className="flex gap-1">
                    <Button variant="outline" size="sm" disabled={i === 0} aria-label={t('admin.candidateTemplate.up', 'Move {{name}} up', { name: r.label || i + 1 })} onClick={() => move(i, -1)}>↑</Button>
                    <Button variant="outline" size="sm" disabled={i === live.length - 1} aria-label={t('admin.candidateTemplate.down', 'Move {{name}} down', { name: r.label || i + 1 })} onClick={() => move(i, 1)}>↓</Button>
                    <Button variant="outline" size="sm" aria-label={t('admin.candidateTemplate.remove', 'Remove {{name}}', { name: r.label || i + 1 })} onClick={() => setRows(live.filter((x) => x.key !== r.key))}>{t('admin.candidateTemplate.removeShort', 'Remove')}</Button>
                  </span>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" disabled={live.length >= MAX_ITEMS} onClick={() => setRows([...live, fresh()])}>{t('admin.candidateTemplate.add', 'Add a check')}</Button>
              <Button variant="primary" disabled={!dirty || blank || save.isPending} onClick={() => void onSave()}>{t('admin.candidateTemplate.save', 'Save checklist')}</Button>
              {dirty && <Button variant="ghost" onClick={() => setRows(null)}>{t('admin.candidateTemplate.discard', 'Discard changes')}</Button>}
            </div>
          </>
        )}
      </div>
    </section>
  );
};
export default WorkOrderCandidateTemplate;
