import React from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox, SelectField, TextField } from '@/src/components/ui';
import { REPORT_KINDS, type ReportFrequency, type ReportKind, type ScheduledReportInput, type ReportRecipientOption } from '@/src/lib/db/scheduledReports';
import { NOTIFY_ROLES } from '@/src/lib/db/documentExpiry';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const toggleIn = (list: string[], v: string, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v));

/** The one set of fields for a scheduled report, used inline in Administration and in the dialog opened from a report. */
export const ScheduledReportFields: React.FC<{
  draft: ScheduledReportInput;
  setDraft: (next: ScheduledReportInput) => void;
  people: ReportRecipientOption[];
  /** The report is fixed when the form is opened from that report itself. */
  kindLocked?: boolean;
}> = ({ draft, setDraft, people, kindLocked = false }) => {
  const { t } = useTranslation('emailNotifications');
  const kindLabel: Record<ReportKind, string> = {
    daily_progress: t('scheduled.kinds.daily_progress', 'Daily progress summary'),
    overdue_tasks: t('scheduled.kinds.overdue_tasks', 'Overdue tasks'),
  };
  const dayLabel: Record<number, string> = {
    1: t('scheduled.days.1', 'Monday'), 2: t('scheduled.days.2', 'Tuesday'), 3: t('scheduled.days.3', 'Wednesday'),
    4: t('scheduled.days.4', 'Thursday'), 5: t('scheduled.days.5', 'Friday'), 6: t('scheduled.days.6', 'Saturday'), 7: t('scheduled.days.7', 'Sunday'),
  };
  return (
    <>
          <TextField label={t('scheduled.name', 'Name')} value={draft.name} maxLength={120} required onChange={(name) => setDraft({ ...draft, name })} />
          {!kindLocked && <SelectField
            label={t('scheduled.kind', 'Report')} value={draft.kind}
            onChange={(kind) => setDraft({ ...draft, kind: kind as ReportKind })}
            options={REPORT_KINDS.map((k) => ({ value: k, label: kindLabel[k] }))}
          />}
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
              {people.map((p) => {
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
      {draft.recipientUserIds.length + draft.recipientRoles.length === 0 ? (
        <p className="text-control text-muted-foreground">{t('scheduled.recipientsHint', 'Pick at least one role or person.')}</p>
      ) : null}
    </>
  );
};
