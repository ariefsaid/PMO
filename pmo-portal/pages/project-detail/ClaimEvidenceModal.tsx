import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox, EntityFormModal, FormSection, SelectField, ListState, useToast, type SubmitError } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';

/**
 * Attach billing evidence to a claim (#766, DD-PBL-7): a document from THIS project's register that is Issued or
 * Approved (its content is frozen) and has a file. The server re-checks all of it; this list only stops the user
 * choosing something the server would refuse. Attach-only — there is no detach.
 */
interface ClaimEvidenceModalPropsBase {
  documents: ProjectDocumentRow[];
  attachedDocumentIds: string[];
  /** Documents already attached to earlier claims of the same work order: offered pre-ticked, so the same papers are not asked for again (BQ10). */
  earlierDocumentIds?: string[];
  sourcePending?: boolean;
  onClose: () => void;
  onAttach: (documentId: string) => Promise<void>;
  onError: (err: unknown) => void;
}

export type ClaimEvidenceModalProps = ClaimEvidenceModalPropsBase & (
  | { sourceError: string | null; onRetry: () => void }
  | { sourceError?: undefined; onRetry?: () => void }
);

const EVIDENCE_STATUSES = new Set(['Issued', 'Approved']);

const ClaimEvidenceModal: React.FC<ClaimEvidenceModalProps> = ({ documents, attachedDocumentIds, earlierDocumentIds = [], sourcePending = false, sourceError = null, onRetry, onClose, onAttach, onError }) => {
  const { t } = useTranslation('project');
  const { toast } = useToast();
  const [choice, setChoice] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);
  const [completed, setCompleted] = useState<string[]>([]);

  const label = (d: ProjectDocumentRow) => `${d.code ? `${d.code} · ` : ''}${d.title} (${d.status}${d.revision
    ? `, ${t('projectDetail.billing.evidence.revision', 'rev {{revision}}', { revision: d.revision })}` : ''})`;
  const eligible = documents.filter((d) => EVIDENCE_STATUSES.has(d.status) && Boolean(d.file_path) && !attachedDocumentIds.includes(d.id) && !completed.includes(d.id));
  const earlier = eligible.filter((d) => earlierDocumentIds.includes(d.id));
  const [unticked, setUnticked] = useState<string[]>([]);
  const toAttach = [...earlier.filter((d) => !unticked.includes(d.id)).map((d) => d.id), ...(choice && !earlierDocumentIds.includes(choice) ? [choice] : [])];
  const options = [
    { value: '', label: '—' },
    ...eligible.filter((d) => !earlier.some((e) => e.id === d.id)).map((d) => ({
      value: d.id,
      label: label(d),
    })),
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (toAttach.length === 0) return;
    setSaving(true);
    setSaveError(null);
    // One confirm, one attach per document (the server re-checks each); a refusal stops the rest and shows in the dialog.
    void toAttach.reduce<Promise<void>>((done, id) => done.then(async () => { await onAttach(id); setCompleted((ids) => [...ids, id]); }), Promise.resolve())
      .then(() => { toast(t('projectDetail.billing.claims.toast.evidenceAttached', 'Evidence attached'), undefined, 'success'); onClose(); })
      .catch((err: unknown) => {
        const { headline, detail } = classifyMutationError(err, undefined, { suppressCapture: true });
        setSaveError({ headline, detail });
        onError(err);
      })
      .finally(() => setSaving(false));
  };

  return (
    <EntityFormModal
      open
      title={t('projectDetail.billing.evidence.title', 'Attach billing evidence')}
      submitLabel={t('projectDetail.billing.evidence.save', 'Attach')}
      onSubmit={handleSubmit}
      submitError={saveError}
      onClose={onClose}
      loading={saving}
      dirty={toAttach.length > 0}
      submitDisabled={toAttach.length === 0 || sourcePending || Boolean(sourceError)}
    >
      <FormSection legend={t('projectDetail.billing.evidence.title', 'Attach billing evidence')}>
        {sourceError ? (
          <ListState variant="error" title={sourceError} onRetry={onRetry!} />
        ) : sourcePending ? (
          <ListState variant="loading" rows={2} />
        ) : eligible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('projectDetail.billing.evidence.none', 'No issued or approved document with a file on this project.')}
          </p>
        ) : (
          <>
            {earlier.length > 0 && (
              <fieldset className="mb-3 space-y-1">
                <legend className="mb-1 text-sm font-medium">{t('projectDetail.billing.evidence.earlier', 'Used on earlier claims of this work order')}</legend>
                {earlier.map((d) => (
                  <Checkbox key={d.id} checked={!unticked.includes(d.id)} label={label(d)}
                    onChange={(on) => setUnticked((u) => (on ? u.filter((x) => x !== d.id) : [...u, d.id]))}>
                    {label(d)}
                  </Checkbox>
                ))}
              </fieldset>
            )}
            {options.length > 1 && (
              <SelectField id="evidence-document" label={t('projectDetail.billing.evidence.document', 'Evidence document')}
                value={choice} onChange={setChoice} options={options} />
            )}
          </>
        )}
      </FormSection>
    </EntityFormModal>
  );
};

export default ClaimEvidenceModal;
