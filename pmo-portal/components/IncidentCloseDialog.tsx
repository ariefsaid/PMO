import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityFormModal, TextArea, Button, Icon } from '@/src/components/ui';
import { FileInput } from '@/src/components/ui/FormFields';
import { needsCloseProof } from '@/src/lib/incidents/overdue';
import type { IncidentRow } from '@/src/lib/db/incidents';
import { useIncidentEvidenceMutations } from '@/src/hooks/useIncidents';

/**
 * Close an issue with proof (#2521, FR-SIL-012). A close note and close photos; a High or Critical issue needs at least one
 * photo (the database enforces it — this only stops the form submitting without one). Photos upload first, then the
 * status moves, so a failed upload leaves the issue open and the form filled in.
 */
export const IncidentCloseDialog: React.FC<{
  incident: IncidentRow;
  /** Moves the status to Closed with the note; throws on failure. */
  onClose: (note: string) => Promise<void>;
  onCancel: () => void;
  onError: (err: unknown) => void;
}> = ({ incident, onClose, onCancel, onError }) => {
  const { t } = useTranslation('incidents');
  const { upload } = useIncidentEvidenceMutations();
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const proofRequired = needsCloseProof(incident.severity);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const remaining = [...photos];
      while (remaining.length > 0) {
        await upload.mutateAsync({ incident, kind: 'at_close', file: remaining[0] });
        remaining.shift();
        setPhotos([...remaining]);
      }
      await onClose(note);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <EntityFormModal
      open
      title={t('transition.Closed.title', 'Close {{type}}?', { type: incident.type })}
      submitLabel={t('transition.Closed.action', 'Close incident')}
      onSubmit={submit}
      onClose={onCancel}
      loading={busy}
      dirty={note.trim() !== '' || photos.length > 0}
      submitDisabled={proofRequired && photos.length === 0}
    >
      <p className="mb-3 text-control text-muted-foreground">{t('transition.Closed.body', 'This marks the incident Closed. Closed is the final state; reopen by filing a follow-up if new information emerges.')}</p>
      <TextArea
        id="incident-close-note"
        label={t('close.note', 'Close note')}
        value={note}
        onChange={setNote}
        placeholder={t('close.notePlaceholder', 'What was done to fix it.')}
        fullWidth
      />
      <div className="mt-3">
        <FileInput
          ref={input}
          accept="image/*"
          capture="environment"
          multiple
          hidden
          data-testid="incident-close-photo-input"
          aria-label={t('close.addPhoto', 'Add close photo')}
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            e.target.value = '';
            setPhotos((prev) => [...prev, ...picked].slice(0, 10));
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
          <Icon name="plus" />
          {t('close.addPhoto', 'Add close photo')}
        </Button>
        <span className="ml-2 text-control text-muted-foreground">
          {proofRequired ? t('close.proofRequired', 'A close photo is required for a High or Critical issue.') : t('close.proofOptional', 'Optional for this severity.')}
        </span>
        {photos.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1">
            {photos.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 text-control">
                <span className="truncate">{f.name}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}>
                  {t('form.removePhoto', 'Remove')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </EntityFormModal>
  );
};

export default IncidentCloseDialog;
