import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog, DateField, useToast } from '@/src/components/ui';
import { usePeopleMutations } from '@/src/hooks/usePeople';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatCalendarDayInTimeZone } from '@/src/lib/format';
import { getActiveLocale } from '@/src/lib/locale/activeLocale';

/** "Mark as left": the day a person left. They move to former staff and leave every crew roster from that day; their history
 *  stays. The day starts as today on the organisation calendar. Used by the People register and the person record. */
export const MarkLeftDialog: React.FC<{ person: { id: string; name: string } | null; onClose: () => void }> = ({ person, onClose }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { markLeft } = usePeopleMutations();
  const [day, setDay] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const today = formatCalendarDayInTimeZone(new Date(), getActiveLocale().timezone);
  const leftOn = day || today;

  const close = () => { setDay(''); setProblem(null); onClose(); };
  const confirm = async () => {
    if (!person) return;
    setProblem(null);
    try {
      await markLeft.mutateAsync({ id: person.id, leftOn });
      toast(t('administration:people.markedLeft', '{{name}} is now former staff', { name: person.name }), undefined, 'success');
      close();
    } catch (err) {
      const c = classifyMutationError(err);
      setProblem(`${c.headline}. ${c.detail}`);
    }
  };

  return (
    <ConfirmDialog open={person !== null} tone="destructive"
      title={t('administration:people.leftTitle', 'Mark {{name}} as left', { name: person?.name ?? '' })}
      description={(
        <div className="space-y-3">
          <p>{t('administration:people.leftBody', 'They move to Former staff and leave every crew roster from this day. Their documents, hours and history stay on record.')}</p>
          <DateField label={t('administration:people.leftOn', 'Last day of work')} value={leftOn} onChange={setDay} required />
        </div>
      )}
      confirmLabel={t('administration:people.markLeft', 'Mark as left')} loading={markLeft.isPending} error={problem}
      onConfirm={() => void confirm()} onCancel={close} />
  );
};
