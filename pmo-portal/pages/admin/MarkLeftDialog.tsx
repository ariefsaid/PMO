import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog, DateField, useToast } from '@/src/components/ui';
import { usePeopleMutations } from '@/src/hooks/usePeople';
import { refusalLine, useRefusalText } from '@/src/lib/refusals';
import { formatCalendarDayInTimeZone } from '@/src/lib/format';
import { getActiveLocale } from '@/src/lib/locale/activeLocale';

/** "Mark as left": the day a person left. They move to former staff and leave every crew roster from that day; their history
 *  stays. The day starts as today on the organisation calendar, and a cleared field stays blank until a real day is entered.
 *  Used by the People register and the person record. */
export const MarkLeftDialog: React.FC<{ person: { id: string; name: string } | null; onClose: () => void }> = ({ person, onClose }) => {
  const { t } = useTranslation();
  const refusal = useRefusalText();
  const { toast } = useToast();
  const { markLeft } = usePeopleMutations();
  const [day, setDay] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const today = formatCalendarDayInTimeZone(new Date(), getActiveLocale().timezone);
  // `null` = untouched: the dialog opens on the organisation's today. `''` = the admin cleared the field:
  // it stays blank while they edit, and the required day must be entered again — an emptied draft is never
  // silently turned back into today.
  const leftOn = day ?? today;

  const close = () => { setDay(null); setProblem(null); onClose(); };
  const confirm = async () => {
    if (!person || !leftOn) return;
    setProblem(null);
    try {
      await markLeft.mutateAsync({ id: person.id, leftOn });
      toast(t('administration:people.markedLeft', '{{name}} is now former staff', { name: person.name }), undefined, 'success');
      close();
    } catch (err) {
      setProblem(refusalLine(refusal(err)));
    }
  };

  return (
    <ConfirmDialog open={person !== null} tone="destructive"
      title={t('administration:people.leftTitle', 'Mark {{name}} as left', { name: person?.name ?? '' })}
      description={(
        <div className="space-y-3">
          <p>{t('administration:people.leftBody', 'They move to Former staff and leave every crew roster from this day. Their documents, hours and history stay on record.')}</p>
          <DateField
            label={t('administration:people.leftOn', 'First day off crew roster')}
            helper={t('administration:people.leftOnHelp', 'From this date onward, this person will no longer appear on crew rosters.')}
            value={leftOn}
            onChange={setDay}
            required
          />
        </div>
      )}
      confirmLabel={t('administration:people.markLeft', 'Mark as left')} loading={markLeft.isPending} error={problem}
      confirmDisabled={!leftOn}
      onConfirm={() => void confirm()} onCancel={close} />
  );
};
