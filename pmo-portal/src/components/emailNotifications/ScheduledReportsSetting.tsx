import React from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, ConfirmDialog, SelectField, StatusPill, Switch, TextField, useToast } from '@/src/components/ui';
import { scheduledReportsRepository } from '@/src/lib/repositories/scheduledReports';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { usePermission } from '@/src/auth/usePermission';
import { REPORT_KINDS, type ReportKind, type ReportFrequency, type ScheduledReport, type ScheduledReportInput } from '@/src/lib/db/scheduledReports';
import { NOTIFY_ROLES } from '@/src/lib/db/documentExpiry';

const KEY = ['scheduledReports'] as const;
const OPTIONS_KEY = ['scheduledReportRecipients'] as const;
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const BLANK: ScheduledReportInput = {
  id: null, name: '', kind: 'daily_progress', frequency: 'daily', weekday: null, sendTime: '08:00',
  recipientUserIds: [], recipientRoles: [], enabled: true,
};

/**
 * Scheduled reports (#2714), a subsection of the Administration email card. Admin only (`can('manage','orgEmailNotifications')`);
 * UX only: save_scheduled_report and its siblings (1228) re-check the Admin role. It renders nothing until an email event is
 * switched on or a report exists, so an organisation that never uses it sees the card exactly as before.
 */
export const ScheduledReportsSetting: React.FC<{ eventsOn: boolean }> = ({ eventsOn }) => {
  const { t } = useTranslation('emailNotifications');
  const { toast } = useToast();
  const qc = useQueryClient();
  const canManage = usePermission()('manage', 'orgEmailNotifications');
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
  if (!eventsOn && reports.length === 0 && draft === null) return null;

  const valid = draft !== null && draft.name.trim() !== '' && draft.recipientUserIds.length + draft.recipientRoles.length > 0
    && (draft.frequency === 'daily' || draft.weekday !== null) && /^\d{2}:\d{2}$/.test(draft.sendTime);
  const toggleIn = (list: string[], v: string, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v));

  return (
    <section className="mt-6 border-t border-border pt-4" aria-labelledby="scheduled-reports-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 id="scheduled-reports-title" className="text-control font-medium">{t('scheduled.title', 'Scheduled reports')}</h4>
        {draft === null ? (
          <Button variant="outline" onClick={() => { setError(null); setDraft(BLANK); }}>{t('scheduled.add', 'Add a scheduled report')}</Button>
        ) : null}
      </div>
      <p className="mt-1 text-control text-muted-foreground">
        {t('scheduled.intro', 'Email a report to people or roles on a schedule. Times are in the organisation timezone. Each person sees only the figures their role allows.')}
      </p>
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
                  <Switch checked={r.enabled} labelledBy={titleId} disabled={toggle.isPending} onChange={(next) => toggle.mutate({ id: r.id, enabled: next })} />
                  <Button variant="outline" onClick={() => { setError(null); setDraft({ ...r }); }}>{t('scheduled.edit', 'Edit')}</Button>
                  <Button variant="outline" onClick={() => setArchiving(r)}>{t('scheduled.archive', 'Archive')}</Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {draft !== null ? (
        <form
          className="mt-3 grid max-w-xl gap-3 rounded-lg border border-border px-4 py-3"
          onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(draft); }}
          aria-label={t('scheduled.formLabel', 'Scheduled report')}
        >
          <TextField label={t('scheduled.name', 'Name')} value={draft.name} maxLength={120} required onChange={(name) => setDraft({ ...draft, name })} />
          <SelectField
            label={t('scheduled.kind', 'Report')} value={draft.kind}
            onChange={(kind) => setDraft({ ...draft, kind: kind as ReportKind })}
            options={REPORT_KINDS.map((k) => ({ value: k, label: kindLabel[k] }))}
          />
          <SelectField
            label={t('scheduled.frequency', 'Repeats')} value={draft.frequency}
            onChange={(f) => setDraft({ ...draft, frequency: f as ReportFrequency, weekday: f === 'weekly' ? (draft.weekday ?? 1) : null })}
            options={[{ value: 'daily', label: t('scheduled.daily', 'Daily') }, { value: 'weekly', label: t('scheduled.weekly', 'Weekly') }]}
          />
          {draft.frequency === 'weekly' ? (
            <SelectField
              label={t('scheduled.weekday', 'On')} value={String(draft.weekday ?? 1)}
              onChange={(d) => setDraft({ ...draft, weekday: Number(d) })}
              options={WEEKDAYS.map((d) => ({ value: String(d), label: dayLabel[d] }))}
            />
          ) : null}
          <TextField label={t('scheduled.time', 'Send time')} type="time" value={draft.sendTime} required onChange={(sendTime) => setDraft({ ...draft, sendTime })} />
          <fieldset>
            <legend className="text-control text-muted-foreground">{t('scheduled.roles', 'Send to these roles')}</legend>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {NOTIFY_ROLES.map((role) => {
                const id = `scheduled-role-${role}`;
                return (
                  <label key={role} className="flex min-h-8 items-center gap-2 text-control">
                    <Checkbox
                      checked={draft.recipientRoles.includes(role)} labelledBy={id} label={role}
                      onChange={(on) => setDraft({ ...draft, recipientRoles: toggleIn(draft.recipientRoles, role, on) })}
                    />
                    <span id={id}>{role}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-control text-muted-foreground">{t('scheduled.people', 'And these people')}</legend>
            <div className="mt-1 flex max-h-40 flex-col gap-1 overflow-y-auto">
              {(people.data ?? []).map((p) => {
                const id = `scheduled-person-${p.id}`;
                return (
                  <label key={p.id} className="flex min-h-8 items-center gap-2 text-control">
                    <Checkbox
                      checked={draft.recipientUserIds.includes(p.id)} labelledBy={id} label={p.name}
                      onChange={(on) => setDraft({ ...draft, recipientUserIds: toggleIn(draft.recipientUserIds, p.id, on) })}
                    />
                    <span id={id}>{p.name}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          {draft.recipientUserIds.length + draft.recipientRoles.length === 0 ? (
            <p className="text-control text-muted-foreground">{t('scheduled.recipientsHint', 'Pick at least one role or person.')}</p>
          ) : null}
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
