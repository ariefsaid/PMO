import React from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, SelectField, StatusPill, Switch, useToast } from '@/src/components/ui';
import { emailNotificationsRepository } from '@/src/lib/repositories/emailNotifications';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { usePermission } from '@/src/auth/usePermission';
import { EMAIL_EVENTS, type EmailEvent, type EmailEventSetting, type EmailLocale } from '@/src/lib/db/emailNotifications';
import { NOTIFY_ROLES } from '@/src/lib/db/documentExpiry';
import { ScheduledReportsSetting } from './ScheduledReportsSetting';

const KEY = ['emailNotificationSettings'] as const;

/**
 * Administration > Organization integrations: which events send email, the extra roles copied on each, and the email language (#2711).
 * Admin edits; everyone else is not shown the card's controls (the Administration page itself is Admin/Operator).
 * UX only: set_email_event_setting / set_email_locale (1223) re-check the Admin role.
 */
export const EmailNotificationsSetting: React.FC = () => {
  const { t } = useTranslation('emailNotifications');
  const { toast } = useToast();
  const qc = useQueryClient();
  const canManage = usePermission()('manage', 'orgEmailNotifications');
  // Keys are referenced statically (the i18n completeness gate collects only literal t('key') calls).
  const copy: Record<EmailEvent, { title: string; description: string }> = {
    approval_request: { title: t('events.approval_request.title', 'Approval requests'), description: t('events.approval_request.description', 'Something is waiting for a person to approve.') },
    billing_step: { title: t('events.billing_step.title', 'Billing steps'), description: t('events.billing_step.description', 'The next owner of a billing step.') },
    overdue_item: { title: t('events.overdue_item.title', 'Overdue items'), description: t('events.overdue_item.description', 'A task or issue is past its date.') },
    document_expiry: { title: t('events.document_expiry.title', 'Expiring documents'), description: t('events.document_expiry.description', 'A document is close to its expiry date.') },
  };
  const query = useQuery({ queryKey: KEY, queryFn: () => emailNotificationsRepository.getSettings() });
  const onError = (err: unknown) => {
    const { detail } = classifyMutationError(err, {});
    toast(t('saveError', 'The change was not saved'), detail, 'warning');
  };
  const eventMutation = useMutation({
    mutationFn: (v: { event: EmailEvent; enabled: boolean; extraRoles: string[] }) =>
      emailNotificationsRepository.setEvent(v.event, v.enabled, v.extraRoles),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError,
  });
  const localeMutation = useMutation({
    mutationFn: (l: EmailLocale) => emailNotificationsRepository.setLocale(l),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError,
  });

  return (
    <section className="mt-4 rounded-lg border border-border bg-card px-4 py-3" aria-labelledby="email-notifications-title">
      <h3 id="email-notifications-title" className="text-control font-medium">{t('title', 'Email notifications')}</h3>
      <p className="mt-1 text-control text-muted-foreground">
        {t('intro', 'Send an email as well as the in-app notification. Every event is off until you turn it on. Each person can opt out in their profile.')}
      </p>
      {query.isPending ? (
        <p role="status" className="mt-3 text-control text-muted-foreground">{t('loading', 'Loading email settings')}</p>
      ) : query.isError || !query.data ? (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 text-control">
          <span>{t('loadError', 'Email settings could not be loaded.')}</span>
          <Button variant="outline" onClick={() => void query.refetch()}>{t('retry', 'Try again')}</Button>
        </div>
      ) : (
        <>
          <ul className="mt-3 divide-y divide-border">
            {EMAIL_EVENTS.map((event) => {
              const s = query.data.events.find((e: EmailEventSetting) => e.event === event)!;
              const titleId = `email-event-${event}`;
              const title = copy[event].title;
              return (
                <li key={event} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span id={titleId} className="text-control font-medium">{title}</span>
                      <p className="text-control text-muted-foreground">{copy[event].description}</p>
                    </div>
                    {canManage ? (
                      <Switch
                        checked={s.enabled}
                        labelledBy={titleId}
                        disabled={eventMutation.isPending}
                        onChange={(next) => eventMutation.mutate({ event, enabled: next, extraRoles: s.extraRoles })}
                      />
                    ) : (
                      <StatusPill variant={s.enabled ? 'won' : 'neutral'}>{s.enabled ? t('on', 'On') : t('off', 'Off')}</StatusPill>
                    )}
                  </div>
                  {s.enabled && canManage ? (
                    <fieldset className="mt-2">
                      <legend className="text-control text-muted-foreground">{t('extraRoles', 'Also email these roles')}</legend>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                        {NOTIFY_ROLES.map((role) => {
                          const id = `email-${event}-${role}`;
                          const checked = s.extraRoles.includes(role);
                          return (
                            <label key={role} className="flex min-h-8 items-center gap-2 text-control">
                              <Checkbox
                                checked={checked}
                                labelledBy={id}
                                label={role}
                                disabled={eventMutation.isPending}
                                onChange={(next) =>
                                  eventMutation.mutate({
                                    event, enabled: true,
                                    extraRoles: next ? [...s.extraRoles, role] : s.extraRoles.filter((r: string) => r !== role),
                                  })}
                              />
                              <span id={id}>{role}</span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {canManage ? (
            <div className="mt-2 max-w-xs">
              <SelectField
                label={t('language', 'Email language')}
                value={query.data.locale}
                disabled={localeMutation.isPending}
                onChange={(value) => localeMutation.mutate(value as EmailLocale)}
                options={[
                  { value: 'en', label: t('languageEn', 'English') },
                  { value: 'id', label: t('languageId', 'Indonesian') },
                ]}
              />
            </div>
          ) : null}
          <ScheduledReportsSetting />
        </>
      )}
    </section>
  );
};
