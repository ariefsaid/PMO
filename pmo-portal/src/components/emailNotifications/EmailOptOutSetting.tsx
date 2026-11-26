import { useSettingsSaveEntry } from '@/src/components/admin/settingsSaveContext';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '@/src/components/ui';
import { emailNotificationsRepository } from '@/src/lib/repositories/emailNotifications';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

/**
 * Profile: a person's own switch for the email copy of their notifications (#2711). On by default; the in-app
 * notification is unaffected. Plain state, not react-query, so the profile page keeps rendering without a query client.
 * Nothing renders until the stored choice is known, and nothing renders if it cannot be read.
 */
export const EmailOptOutSetting: React.FC = () => {
  const { t } = useTranslation('emailNotifications');
  const [optedOut, setOptedOut] = useState<boolean | null>(null);
  const [draftSend, setDraftSend] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    emailNotificationsRepository.getMyOptOut().then((v) => { if (live) setOptedOut(v); }, () => undefined);
    return () => { live = false; };
  }, []);

  const pageSave = useSettingsSaveEntry(optedOut === null ? null : {
    dirty: draftSend !== null && draftSend !== !optedOut, busy,
    save: async () => { if (draftSend !== null) { if (!await change(draftSend)) throw new Error('Email preference was not saved'); setDraftSend(null); } },
  });
  if (optedOut === null) return null;
  const sendEmail = draftSend ?? !optedOut;
  const label = t('optOut.label', 'Send me email notifications');
  const change = (sendEmail: boolean) => {
    setBusy(true);
    setError(null);
    return emailNotificationsRepository.setMyOptOut(!sendEmail).then(
      () => { setOptedOut(!sendEmail); setBusy(false); return true; },
      (err: unknown) => { setError(classifyMutationError(err, {}).detail ?? t('saveError', 'The change was not saved')); setBusy(false); return false; },
    );
  };
  return (
    <section className="mt-6 rounded-lg border border-border bg-card px-4 py-3" aria-labelledby="email-optout-title">
      <h2 id="email-optout-title" className="text-control font-medium">{t('optOut.title', 'Email notifications')}</h2>
      <div className="mt-1 flex items-center justify-between gap-3">
        <p id="email-optout-desc" className="text-control text-muted-foreground">
          {t('optOut.description', 'Receive emails from PMO about approvals, overdue items and expiring documents. In-app notifications are not affected.')}
          <span className="mt-1 block font-medium text-foreground">{!sendEmail ? t('optOut.off', 'Email notifications are off') : t('optOut.on', 'Email notifications are on')}</span>
        </p>
        <Switch checked={sendEmail} label={label} describedBy="email-optout-desc" disabled={busy} onChange={pageSave ? setDraftSend : change} />
      </div>
      {error ? <p role="alert" className="mt-2 text-control text-destructive-text">{error}</p> : null}
    </section>
  );
};
