import React from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, EntityFormModal, FormGrid, useToast } from '@/src/components/ui';
import { isLightRoleKey } from '@/src/auth/lightAccount';
import { useScheduledReportsAccess } from '@/src/hooks/useScheduledReportsAccess';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { scheduledReportsRepository } from '@/src/lib/repositories/scheduledReports';
import type { ReportKind, ScheduledReportInput } from '@/src/lib/db/scheduledReports';
import { ScheduledReportFields } from './ScheduledReportFields';

/**
 * "Send this report every …" on the report itself. Admin or an enabled Project Control Manager opens the same
 * scheduled-report form with the report fixed. UX only: save_scheduled_report (2580) re-checks the role.
 */
export const ScheduleThisReport: React.FC<{ kind: ReportKind }> = ({ kind }) => {
  const { canManage, isAdmin } = useScheduledReportsAccess();
  return canManage ? <ScheduleThisReportDialog kind={kind} isAdmin={isAdmin} /> : null;
};

const ScheduleThisReportDialog: React.FC<{ kind: ReportKind; isAdmin: boolean }> = ({ kind, isAdmin }) => {
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
  const recipientOptions = isAdmin
    ? (people.data ?? [])
    : (people.data ?? []).filter((p) => !isLightRoleKey(p.builtInRole));
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
            <ScheduledReportFields draft={draft} setDraft={setDraft} people={recipientOptions} kindLocked />
          </FormGrid>
        </EntityFormModal>
      )}
    </>
  );
};
