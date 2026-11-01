import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ListState, StatusPill } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { useProjectStageEntries, useStageEntryMutations } from '@/src/hooks/useProjectStageEntries';
import { PIPELINE_STATUSES, type ProjectStatus } from '@/src/lib/db/projectTransitions';
import { formatInstantDate } from '@/src/lib/format';
import { STAGE_KEY_DATE_LABEL, formatIsoDayMonth } from '@/components/salesPipeline';
import StageDateDialog from './StageDateDialog';

/** #1638 FR-PSH-016/017: every stage a deal went through, newest first; editors may correct dates. */
export default function StageHistory({ projectId }: { projectId: string }) {
  const { t } = useTranslation('project');
  const { data: entries = [], isLoading, error } = useProjectStageEntries(projectId);
  const { redate, addSkipped } = useStageEntryMutations();
  const may = usePermission();
  const canEdit = may('transition', 'project'); // same set as the server's editor rank (plan D6)
  const today = useOrgToday();
  const [editing, setEditing] = useState<{ kind: 'redate' | 'add'; index: number } | null>(null);
  const stageLabel = (stage: string) => {
    const [key, fallback] = STAGE_KEY_DATE_LABEL[stage] ?? ['', stage];
    return key ? t(key, fallback) : fallback;
  };
  // entries are newest-first: neighbours of entries[i] are entries[i+1] (earlier) and entries[i-1] (later).
  const boundsFor = (i: number, kind: 'redate' | 'add') => kind === 'redate'
    ? { min: entries[i + 1]?.entered_on ?? null, max: entries[i - 1]?.entered_on ?? today }
    : { min: entries[i + 1]?.entered_on ?? null, max: entries[i].entered_on };
  if (isLoading) return <ListState variant="loading" />;
  if (error) return <ListState variant="error" title={t('projectDetail.stageHistory.loadError', 'Stage history could not load')} />;
  const entry = editing ? entries[editing.index] : null;
  return (
    <section aria-labelledby="stage-history-heading" className="space-y-2">
      <h2 id="stage-history-heading" className="text-sm font-semibold">{t('projectDetail.stageHistory.heading', 'Stage history')}</h2>
      <ol aria-label={t('projectDetail.stageHistory.listLabel', 'Stage history')} className="divide-y divide-border">
        {entries.map((e, i) => (
          <li key={e.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
            <div className="min-w-0 space-y-0.5">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                <span className="tabular">{stageLabel(e.stage)} {formatIsoDayMonth(e.entered_on)}</span>
                {e.redated_at && <StatusPill variant="neutral">{t('projectDetail.stageHistory.redated', 'Date changed')}</StatusPill>}
                {e.source === 'added' && <StatusPill variant="neutral">{t('projectDetail.stageHistory.added', 'Added later')}</StatusPill>}
              </p>
              <p className="text-xs text-muted-foreground">
                {e.recorder?.full_name ?? t('projectDetail.stageHistory.system', 'System')} · {formatInstantDate(e.recorded_at)}
              </p>
            </div>
            {canEdit && (
              <div className="flex shrink-0 flex-wrap items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => setEditing({ kind: 'redate', index: i })}>
                  {t('projectDetail.stageHistory.changeDate', 'Change date')}
                </Button>
                {i < entries.length - 1 && (
                  <Button variant="ghost" size="sm" onClick={() => setEditing({ kind: 'add', index: i })}>
                    {t('projectDetail.stageHistory.addSkipped', 'Add skipped stage')}
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      {editing && entry && (
        <StageDateDialog
          title={editing.kind === 'redate' ? t('projectDetail.stageHistory.changeDate', 'Change date') : t('projectDetail.stageHistory.addSkipped', 'Add skipped stage')}
          initialDate={entry.entered_on}
          {...boundsFor(editing.index, editing.kind)}
          stageOptions={editing.kind === 'add' ? (PIPELINE_STATUSES as readonly ProjectStatus[]) : undefined}
          onConfirm={async ({ enteredOn, stage }) => {
            if (editing.kind === 'redate') await redate.mutateAsync({ entryId: entry.id, enteredOn });
            else await addSkipped.mutateAsync({ beforeEntryId: entry.id, stage: stage!, enteredOn });
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
