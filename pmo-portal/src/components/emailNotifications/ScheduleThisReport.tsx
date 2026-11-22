import React from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, EntityFormModal, FormGrid, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { scheduledReportsRepository } from '@/src/lib/repositories/scheduledReports';
import type { ReportKind, ScheduledReportInput } from '@/src/lib/db/scheduledReports';
import { ScheduledReportFields } from './ScheduledReportFields';

/**
 * "Send this report every …" on the report itself. An Admin opens the same scheduled-report form as Administration, with the report
 * fixed. UX only: save_scheduled_report re-checks the Admin role (1228). Shown to nobody else.
 */
/** Only an Admin gets the control; for everyone else nothing mounts (no queries, no dialog). */
export const ScheduleThisReport: React.FC<{ kind: ReportKind }> = ({ kind }) => {
  const canManage = usePermission()('manage', 'orgEmailNotifications');
  return canManage ? <ScheduleThisReportDialog kind={kind} /> : null;
};

const ScheduleThisReportDialog: React.FC<{ kind: ReportKind }> = ({ kind }) => {
  const { t } = useTranslation('emailNotifications');
  const { toast } = useToast();
  const qc = useQueryClient();
  const canManage = true;
  const kindName = kind === 'daily_progress' ? t('scheduled.kinds.daily_progress', 'Daily progress summary') : t('scheduled.kinds.overdue_tasks', 'Overdue tasks');
  const blank = React.useMemo<ScheduledReportInput>(() => ({
    id: null, name: kindName, kind, frequency: 'daily', weekday: null, sendTime: '08:00', recipientUserIds: [], recipientRoles: [], enabled: true,
  }), [kind, kindName]);
  const [draft, setDraft] = React.useState<ScheduledReportInput | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const people = useQuery({ queryKey: ['scheduledReportRecipients'], queryFn: () => scheduledReportsRepository.recipientOptions(), enabled: canManage && draft !== null });
  const save = useMutation({
    mutationFn: (v: ScheduledReportInput) => scheduledReportsRepository.save(v),
    onSuccess: () => {
      toast(t('scheduled.savedFromReport', 'Done. This report will be emailed on schedule.'), undefined, 'success');
      setDraft(null); setError(null);
      return qc.invalidateQueries({ queryKey: ['scheduledReports'] });
    },
    onError: (err) => setError(classifyMutationError(err, {}).detail ?? t('saveError', 'The change was not saved')),
  });
  const valid = draft !== null && draft.name.trim() !== '' && draft.recipientUserIds.length + draft.recipientRoles.length > 0
    && (draft.frequency === 'daily' || draft.weekday !== null) && /^\d{2}:\d{2}$/.test(draft.sendTime);
  return (
    <>
      <Button variant="outline" onClick={() => { setError(null); setDraft(blank); }}>{t('scheduled.sendEvery', 'Send this report every …')}</Button>
      {draft !== null && (
        <EntityFormModal open title={t('scheduled.sendEveryTitle', 'Email this report on a schedule')} submitLabel={t('scheduled.save', 'Save report')}
          onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(draft); }} onClose={() => { setDraft(null); setError(null); }}
          loading={save.isPending} dirty submitDisabled={!valid}
          submitError={error ? { headline: t('saveError', 'The change was not saved'), detail: error } : null}>
          <FormGrid>
            <ScheduledReportFields draft={draft} setDraft={setDraft} people={people.data ?? []} kindLocked />
          </FormGrid>
        </EntityFormModal>
      )}
    </>
  );
};
