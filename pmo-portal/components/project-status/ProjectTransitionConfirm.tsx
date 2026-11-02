import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/src/components/ui';
import { projectStatusGroup, type ProjectStatus } from '@/src/lib/db/projectTransitions';
import { projectConfirmCopy } from './projectTransitionCopy';
import { LostReasonFields, type LostReasonValue } from './LostReasonFields';
import { lostReasonValid } from '@/src/lib/lostReasons';

/** The status menu's confirm-before-write dialog, shared with the board drop (DND, #1637). */
export const ProjectTransitionConfirm: React.FC<{
  target: ProjectStatus;
  /** Several legal statuses for one drop (Lost column): a required choice, no preselection. */
  choice?: ProjectStatus[];
  loading: boolean;
  onCancel: () => void;
  onConfirm: (to: ProjectStatus, lost?: LostReasonValue) => void;
}> = ({ target, choice, loading, onCancel, onConfirm }) => {
  const { t } = useTranslation('boardDrag');
  const [picked, setPicked] = useState<ProjectStatus | null>(null);
  const [lost, setLost] = useState<LostReasonValue>({ reason: '', note: '' });
  const copy = projectConfirmCopy(target);

  const lostTarget = (choice ?? [target]).some((s) => projectStatusGroup(s as never) === 'lost');

  const description = (
    <>
      <p>{copy.description}</p>
      {choice && (
        <fieldset className="mt-3">
          <legend className="text-xs font-semibold">{t('boardDrag:lostChoice.legend', 'Which outcome?')}</legend>
          {choice.map((s) => (
            <label key={s} className="mt-1 flex items-center gap-2 text-sm">
              <input type="radio" name="lost-outcome" value={s} checked={picked === s} onChange={() => setPicked(s)} />
              {s}
            </label>
          ))}
        </fieldset>
      )}
      {lostTarget && <LostReasonFields idPrefix="confirm" value={lost} onChange={setLost} />}
    </>
  );

  return (
    <ConfirmDialog
      open
      tone={copy.tone}
      title={copy.title}
      description={description}
      confirmLabel={copy.confirmLabel}
      loading={loading}
      confirmDisabled={(!!choice && !picked) || (lostTarget && !lostReasonValid(lost.reason, lost.note))}
      onCancel={onCancel}
      onConfirm={() => onConfirm(choice ? (picked as ProjectStatus) : target, lostTarget ? lost : undefined)}
    />
  );
};
