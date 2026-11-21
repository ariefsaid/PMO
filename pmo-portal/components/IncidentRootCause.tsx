import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, TextArea } from '@/src/components/ui';

/** The root cause of an issue (#2677): shown apart from the description; a manager or the person in charge edits it in place. */
export const IncidentRootCause: React.FC<{
  value: string | null;
  canEdit: boolean;
  onSave: (text: string) => Promise<void>;
  onError: (err: unknown) => void;
}> = ({ value, canEdit, onSave, onError }) => {
  const { t } = useTranslation('incidents');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  if (!editing) {
    return (
      <div data-testid="incident-root-cause" className="flex flex-col gap-2">
        {value ? (
          <p className="whitespace-pre-wrap text-control leading-relaxed">{value}</p>
        ) : (
          <p className="text-control text-muted-foreground">{t('rootCause.none', 'No root cause recorded yet.')}</p>
        )}
        {canEdit && (
          <div>
            <Button variant="outline" size="sm" data-testid="incident-root-cause-edit" onClick={() => { setDraft(value ?? ''); setEditing(true); }}>
              {value ? t('rootCause.edit', 'Edit root cause') : t('rootCause.add', 'Record the root cause')}
            </Button>
          </div>
        )}
      </div>
    );
  }
  return (
    <form
      data-testid="incident-root-cause-form"
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSave(draft);
          setEditing(false);
        } catch (err) {
          onError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <TextArea
        id="incident-root-cause-input"
        label={t('rootCause.label', 'Root cause')}
        value={draft}
        onChange={setDraft}
        placeholder={t('rootCause.placeholder', 'Why it happened, apart from the visible blocker.')}
        maxLength={1000}
        fullWidth
      />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" loading={busy} data-testid="incident-root-cause-save">{t('rootCause.save', 'Save')}</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>{t('rootCause.cancel', 'Cancel')}</Button>
      </div>
    </form>
  );
};
