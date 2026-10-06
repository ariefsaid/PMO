import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityFormModal, FormSection, SelectField, type SubmitError } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';

/**
 * Attach billing evidence to a claim (#766, DD-PBL-7): a document from THIS project's register that is Issued or
 * Approved (its content is frozen) and has a file. The server re-checks all of it; this list only stops the user
 * choosing something the server would refuse. Attach-only — there is no detach.
 */
export interface ClaimEvidenceModalProps {
  documents: ProjectDocumentRow[];
  attachedDocumentIds: string[];
  onClose: () => void;
  onAttach: (documentId: string) => Promise<void>;
  onError: (err: unknown) => void;
}

const EVIDENCE_STATUSES = new Set(['Issued', 'Approved']);

const ClaimEvidenceModal: React.FC<ClaimEvidenceModalProps> = ({ documents, attachedDocumentIds, onClose, onAttach, onError }) => {
  const { t } = useTranslation();
  const [choice, setChoice] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const eligible = documents.filter((d) => EVIDENCE_STATUSES.has(d.status) && Boolean(d.file_path) && !attachedDocumentIds.includes(d.id));
  const options = [
    { value: '', label: '—' },
    ...eligible.map((d) => ({
      value: d.id,
      label: `${d.code ? `${d.code} · ` : ''}${d.title} (${d.status}${d.revision
        ? `, ${t('projectDetail.billing.evidence.revision', 'rev {{revision}}', { revision: d.revision })}` : ''})`,
    })),
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!choice) return;
    setSaving(true);
    setSaveError(null);
    void onAttach(choice)
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
      subtitle={t('projectDetail.billing.evidence.subtitle', "Choose an issued or approved document from this project's register, such as the progress report or the client's acceptance.")}
      submitLabel={t('projectDetail.billing.evidence.save', 'Attach')}
      onSubmit={handleSubmit}
      submitError={saveError}
      onClose={onClose}
      loading={saving}
      dirty={choice !== ''}
      submitDisabled={!choice}
    >
      <FormSection legend={t('projectDetail.billing.evidence.title', 'Attach billing evidence')}>
        {eligible.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            {t('projectDetail.billing.evidence.none', 'No issued or approved document with a file on this project.')}
          </p>
        ) : (
          <SelectField id="evidence-document" label={t('projectDetail.billing.evidence.document', 'Evidence document')}
            value={choice} onChange={setChoice} options={options} />
        )}
      </FormSection>
    </EntityFormModal>
  );
};

export default ClaimEvidenceModal;
