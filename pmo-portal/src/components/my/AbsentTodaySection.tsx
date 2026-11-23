import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, TextField } from '@/src/components/ui';
import { useMyAbsence, useReportAbsence } from '@/src/hooks/useMyHome';
import type { AbsenceReason, MyHomeWorkOrder } from '@/src/lib/repositories/myHome';
import { MySection } from './MySection';

/**
 * "I am not coming in today" (walk finding: a field worker had no way to say they are absent). Two taps: open, then pick sick
 * or other; a note is optional. The database names the person (the signed-in account's own record), tells the crew's roster
 * keeper and, while leave requests are on, the leave approver, and the roster shows the person as reported absent. It is a
 * statement, not leave: nothing is approved by it. Offered only to a person who has a record on a crew (`my_worker_id`).
 */
export const AbsentTodaySection: React.FC<{ today: string; workOrders: MyHomeWorkOrder[] }> = ({ today, workOrders }) => {
  const { t } = useTranslation('myHome');
  const mine = useMyAbsence(today);
  const report = useReportAbsence();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  if (!workOrders.some((w) => w.my_worker_id)) return null;
  const reasonLabel = (r: AbsenceReason) => (r === 'sick' ? t('myHome:absent.sick', 'I am sick') : t('myHome:absent.other', 'Another reason'));
  const send = (reason: AbsenceReason) => report.mutate({ reason, note }, { onSuccess: () => { setOpen(false); setNote(''); } });
  const reported = mine.data;
  return (
    <MySection id="my-absent" title={t('myHome:absent.title', 'Not coming in today?')}>
      {reported && (
        <p className="text-control text-foreground" role="status" data-testid="absent-reported">
          {t('myHome:absent.reported', 'You told your crew leader you are not coming in today: {{reason}}.', { reason: reasonLabel(reported.reason) })}
        </p>
      )}
      {!open ? (
        <Button variant="outline" onClick={() => setOpen(true)} data-testid="absent-open">
          {reported ? t('myHome:absent.change', 'Change what I told them') : t('myHome:absent.open', 'I am not coming in today')}
        </Button>
      ) : (
        <div className="space-y-3">
          <TextField label={t('myHome:absent.note', 'Note for your crew leader (optional)')} value={note} onChange={setNote} maxLength={300} />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={report.isPending} onClick={() => send('sick')} data-testid="absent-sick">{reasonLabel('sick')}</Button>
            <Button variant="outline" loading={report.isPending} onClick={() => send('other')} data-testid="absent-other">{reasonLabel('other')}</Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>{t('myHome:absent.cancel', 'Cancel')}</Button>
          </div>
          {report.isError && <p role="alert" className="text-sm text-destructive-text">{t('myHome:absent.error', 'Could not send. Check your connection and try again.')}</p>}
        </div>
      )}
    </MySection>
  );
};
