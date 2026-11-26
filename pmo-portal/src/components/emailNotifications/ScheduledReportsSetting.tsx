import { useBuiltInRoleName } from '@/src/hooks/useOrgRoleNames';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, ConfirmDialog, StatusPill, Switch, useToast } from '@/src/components/ui';
import { AuthContext } from '@/src/auth/AuthContext';
import { isLightRoleKey } from '@/src/auth/lightAccount';
import { OrgSwitchSetting } from '@/src/components/admin/OrgSwitchSetting';
import { useScheduledReportsAccess } from '@/src/hooks/useScheduledReportsAccess';
import { scheduledReportsRepository } from '@/src/lib/repositories/scheduledReports';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { type ReportKind, type ScheduledReport, type ScheduledReportInput } from '@/src/lib/db/scheduledReports';
import { ScheduledReportFields } from './ScheduledReportFields';

const KEY = ['scheduledReports'] as const;
const OPTIONS_KEY = ['scheduledReportRecipients'] as const;
const BLANK: ScheduledReportInput = {
  id: null, name: '', kind: 'daily_progress', frequency: 'daily', weekday: null, sendTime: '08:00',
  recipientUserIds: [], recipientRoles: [], enabled: true,
};

/**
 * Scheduled reports (#2714, TC-PC-19). Admin always manages; an active Project Control Manager manages the kinds that role reads
 * when `pcm_scheduled_reports_enabled` is on, and only the schedules that role created. UX only: the RPCs (2580) re-check the role,
 * the schedule's managing role and the recipient read rules.
 */
export const ScheduledReportsSetting: React.FC<{ standalone?: boolean }> = ({ standalone = false }) => {
  const { t } = useTranslation('emailNotifications');
  const roleName = useBuiltInRoleName();
  const { toast } = useToast();
  const qc = useQueryClient();
  const auth = React.useContext(AuthContext);
  const { canManage, isAdmin, canEditRow } = useScheduledReportsAccess();
  const [draft, setDraft] = React.useState<ScheduledReportInput | null>(null);
  const [archiving, setArchiving] = React.useState<ScheduledReport | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const kindLabel: Record<ReportKind, string> = {
    daily_progress: t('scheduled.kinds.daily_progress', 'Daily progress summary'),
    overdue_tasks: t('scheduled.kinds.overdue_tasks', 'Overdue tasks'),
  };
  const dayLabel: Record<number, string> = {
    1: t('scheduled.days.1', 'Monday'), 2: t('scheduled.days.2', 'Tuesday'), 3: t('scheduled.days.3', 'Wednesday'),
    4: t('scheduled.days.4', 'Thursday'), 5: t('scheduled.days.5', 'Friday'), 6: t('scheduled.days.6', 'Saturday'), 7: t('scheduled.days.7', 'Sunday'),
  };

  const query = useQuery({ queryKey: KEY, queryFn: () => scheduledReportsRepository.list(), enabled: canManage });
  const people = useQuery({ queryKey: OPTIONS_KEY, queryFn: () => scheduledReportsRepository.recipientOptions(), enabled: canManage && draft !== null });
  const onError = (err: unknown) => {
    const { detail } = classifyMutationError(err, {});
    toast(t('saveError', 'The change was not saved'), detail, 'warning');
  };
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  const save = useMutation({
    mutationFn: (v: ScheduledReportInput) => scheduledReportsRepository.save(v),
    onSuccess: () => { setDraft(null); setError(null); return refresh(); },
    onError: (err) => setError(classifyMutationError(err, {}).detail ?? t('saveError', 'The change was not saved')),
  });
  const toggle = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => scheduledReportsRepository.setEnabled(v.id, v.enabled),
    onSuccess: refresh, onError,
  });
  const archive = useMutation({
    mutationFn: (id: string) => scheduledReportsRepository.archive(id),
    onSuccess: () => { setArchiving(null); return refresh(); }, onError,
  });

  if (!canManage) return null;
  const reports = query.data ?? [];
  // A Project Control Manager may name only people who can read the report (no field account). One a schedule already carries
  // (an Admin added them) is neither shown nor sent back, so the manager never holds a recipient they cannot keep.
  const recipientOptions = isAdmin ? (people.data ?? []) : (people.data ?? []).filter((p) => !isLightRoleKey(p.builtInRole));
  const shown = draft !== null && !isAdmin
    ? { ...draft, recipientUserIds: draft.recipientUserIds.filter((id) => recipientOptions.some((p) => p.id === id)) }
    : draft;

  const valid = shown !== null && shown.name.trim() !== '' && shown.recipientUserIds.length + shown.recipientRoles.length > 0
    && (shown.frequency === 'daily' || shown.weekday !== null) && /^\d{2}:\d{2}$/.test(shown.sendTime);

  return (
    <section className={standalone ? '' : 'mt-6 border-t border-border pt-4'} aria-labelledby="scheduled-reports-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 id="scheduled-reports-title" className="text-control font-medium">{t('scheduled.title', 'Scheduled reports')}</h4>
        {draft === null ? (
          <Button variant="outline" onClick={() => { setError(null); setDraft(BLANK); }}>{t('scheduled.add', 'Add a scheduled report')}</Button>
        ) : null}
      </div>
      <p className="mt-1 text-control text-muted-foreground">
        {t('scheduled.intro', 'Email a report to people or roles on a schedule. Times are in the organisation timezone. Each person sees only the figures their role allows.')}
      </p>
      {!standalone && isAdmin && auth?.currentUser?.org_id ? (
        <div className="mt-3">
          <OrgSwitchSetting
            setting="pcmScheduledReports" deferSave controlPosition="end"
            label={t('scheduled.pcmSwitchLabel', '{{role}} can schedule reports', { role: roleName('project_control_manager') })}
            helper={t('scheduled.pcmSwitchHelper', 'Lets {{role}} create and manage scheduled reports they can read, for recipients who can also read them.', { role: roleName('project_control_manager') })}
          />
        </div>
      ) : null}
      {query.isError ? (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 text-control">
          <span>{t('scheduled.loadError', 'Scheduled reports could not be loaded.')}</span>
          <Button variant="outline" onClick={() => void query.refetch()}>{t('retry', 'Try again')}</Button>
        </div>
      ) : reports.length === 0 && draft === null && !query.isPending ? (
        <p className="mt-3 text-control text-muted-foreground">{t('scheduled.empty', 'No scheduled reports yet.')}</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {reports.map((r) => {
            const titleId = `scheduled-report-${r.id}`;
            const editable = canEditRow(r);
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <span id={titleId} className="text-control font-medium">{r.name}</span>
                  <p className="text-control text-muted-foreground">
                    {kindLabel[r.kind]}
                    {' · '}
                    {r.frequency === 'weekly' && r.weekday ? t('scheduled.weeklyAt', '{{day}} at {{time}}', { day: dayLabel[r.weekday], time: r.sendTime }) : t('scheduled.dailyAt', 'Every day at {{time}}', { time: r.sendTime })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill variant={r.enabled ? 'won' : 'neutral'}>{r.enabled ? t('on', 'On') : t('off', 'Off')}</StatusPill>
                  {editable ? (
                    <>
                      <Switch checked={r.enabled} labelledBy={titleId} disabled={toggle.isPending} onChange={(next) => toggle.mutate({ id: r.id, enabled: next })} />
                      <Button variant="outline" onClick={() => { setError(null); setDraft({ ...r }); }}>{t('scheduled.edit', 'Edit')}</Button>
                      <Button variant="outline" onClick={() => setArchiving(r)}>{t('scheduled.archive', 'Archive')}</Button>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {draft !== null ? (
        <form
          className="mt-3 grid max-w-xl gap-3 rounded-lg border border-border px-4 py-3"
          onSubmit={(e) => { e.preventDefault(); if (valid && shown) save.mutate(shown); }}
          aria-label={t('scheduled.formLabel', 'Scheduled report')}
        >
          <ScheduledReportFields draft={shown ?? draft} setDraft={setDraft} people={recipientOptions} />
          {error ? <p role="alert" className="text-control text-destructive-text">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={!valid} loading={save.isPending}>{t('scheduled.save', 'Save report')}</Button>
            <Button type="button" variant="outline" onClick={() => { setDraft(null); setError(null); }}>{t('scheduled.cancel', 'Cancel')}</Button>
          </div>
        </form>
      ) : null}
      <ConfirmDialog
        open={archiving !== null}
        title={t('scheduled.archiveTitle', 'Archive this scheduled report')}
        description={t('scheduled.archiveBody', 'It stops sending. Emails already sent are not affected.')}
        confirmLabel={t('scheduled.archive', 'Archive')}
        tone="destructive"
        loading={archive.isPending}
        onConfirm={() => { if (archiving) archive.mutate(archiving.id); }}
        onCancel={() => setArchiving(null)}
      />
    </section>
  );
};
