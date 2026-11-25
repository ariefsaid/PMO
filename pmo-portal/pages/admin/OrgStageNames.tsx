import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button, FieldError, ListState, TextField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { saveStageName, validateStageName } from '@/src/lib/db/stageNames';
import { ORG_STAGE_NAMES_KEY, useOrgStageNames } from '@/src/hooks/useOrgStageNames';
import { projectStatusGroup, type ProjectStatus, type ProjectStatusGroup } from '@/src/lib/db/projectTransitions';
import { STATUS_MAP, shippedStatusLabel } from '@/src/lib/status/statusMap';
import type { StageNameRow } from '@/src/lib/status/orgStageNames';

/**
 * Administration › Project setup › Sales and project stages (#2906 slice 1). An Admin names each stage in
 * English and Bahasa; a blank name keeps the shipped wording. Names only change what people read: stored
 * stages, filters, saved views and reports keep their keys. UX gate only: the Admin-only row policy decides.
 */
const GROUPS: ProjectStatusGroup[] = ['pipeline', 'onHand', 'lost', 'internal'];
const english = (_k: string, d: string) => d;
const STAGE_ORDER = Object.keys(STATUS_MAP.project);

const StageRow: React.FC<{ row: StageNameRow; others: (lang: 'en' | 'id') => string[] }> = ({ row, others }) => {
  const { t } = useTranslation('administration');
  const { t: tStatus } = useTranslation('status');
  const { toast } = useToast();
  const qc = useQueryClient();
  const [en, setEn] = useState(row.label_en ?? '');
  const [id, setId] = useState(row.label_id ?? '');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  useEffect(() => { setEn(row.label_en ?? ''); setId(row.label_id ?? ''); }, [row.label_en, row.label_id]);

  const save = async (next: { en: string; id: string }) => {
    const bad = validateStageName(next.en, others('en')) ?? validateStageName(next.id, others('id'));
    if (bad) { setError(bad === 'tooLong' ? t('admin.stageNames.tooLong', 'Use 40 characters or fewer') : t('admin.stageNames.duplicate', 'Another stage already has this name')); return; }
    setError(undefined); setSaving(true);
    try {
      await saveStageName(row.status, next);
      await qc.invalidateQueries({ queryKey: [...ORG_STAGE_NAMES_KEY] });
      toast(t('admin.stageNames.saved', 'Stage names saved'), undefined, 'success');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setError(detail || headline);
    } finally { setSaving(false); }
  };
  const shipped = shippedStatusLabel('project', row.status, tStatus);

  return (
    <li data-testid={`stage-name-row-${row.status}`} className="grid gap-2 py-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
      <span className="text-control text-foreground">{shipped}</span>
      <TextField label={t('admin.stageNames.english', 'English')} value={en} onChange={setEn} />
      <TextField label={t('admin.stageNames.bahasa', 'Bahasa Indonesia')} value={id} onChange={setId} />
      <span className="flex gap-2">
        <Button variant="primary" size="sm" disabled={saving} onClick={() => void save({ en, id })}>{t('admin.stageNames.save', 'Save')}</Button>
        <Button variant="outline" size="sm" disabled={saving || (!row.label_en && !row.label_id)} onClick={() => void save({ en: '', id: '' })}>{t('admin.stageNames.reset', 'Reset')}</Button>
      </span>
      {error && <FieldError id={`stage-name-error-${row.status}`}>{error}</FieldError>}
    </li>
  );
};

const StageNamesCard: React.FC = () => {
  const { t } = useTranslation('administration');
  const query = useOrgStageNames();
  const groupTitle: Record<ProjectStatusGroup, string> = {
    pipeline: t('admin.stageNames.group.pipeline', 'Pipeline'),
    onHand: t('admin.stageNames.group.onHand', 'On hand'),
    lost: t('admin.stageNames.group.lost', 'Lost'),
    internal: t('admin.stageNames.group.internal', 'Internal'),
  };
  const rows = [...(query.data ?? [])].sort((a, b) => STAGE_ORDER.indexOf(a.status) - STAGE_ORDER.indexOf(b.status));
  const others = (status: string) => (lang: 'en' | 'id') => rows.filter((r) => r.status !== status).map((r) =>
    (lang === 'en' ? r.label_en : r.label_id) ?? (lang === 'en' ? shippedStatusLabel('project', r.status, english) : '')).filter(Boolean);

  return (
    <section id="stage-names" tabIndex={-1} className="scroll-mt-4" aria-labelledby="stage-names-heading">
      <h2 id="stage-names-heading" className="text-group font-semibold tracking-[-0.01em]">{t('admin.stageNames.title', 'Sales and project stages')}</h2>
      <p className="mt-1 max-w-prose text-control text-muted-foreground">{t('admin.stageNames.helper', 'Rename a stage to match your own process. A blank name keeps the shipped name. Records, filters and reports keep working.')}</p>
      {query.isError && !query.data ? (
        <ListState variant="error" title={t('admin.stageNames.loadError', "Couldn't load the stages")} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <ListState variant="loading" rows={3} />
      ) : GROUPS.map((g) => (
        <div key={g} className="mt-4">
          <h3 className="text-control font-semibold text-foreground">{groupTitle[g]}</h3>
          <ul className="divide-y divide-border">
            {rows.filter((r) => projectStatusGroup(r.status as ProjectStatus) === g).map((r) => <StageRow key={r.status} row={r} others={others(r.status)} />)}
          </ul>
        </div>
      ))}
    </section>
  );
};

const OrgStageNames: React.FC = () => (usePermission()('manage', 'orgStageNames') ? <StageNamesCard /> : null);
export default OrgStageNames;
