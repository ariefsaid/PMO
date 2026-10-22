import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  EntityFormModal,
  TextField,
  SelectField,
  FormSection,
  FormGrid,
} from '@/src/components/ui';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';
import { CATEGORY_OPTIONS } from '@/src/lib/documentCategories';
import type { MicrosoftReferenceInput } from '@/src/lib/m365/reference';
import { DocumentDriftBadge } from '@/src/components/m365/DocumentDriftBadge';

/**
 * Auto-bump the revision mark: A→B, 3→4. If the last char is a letter or digit,
 * increment it; otherwise return empty string for manual entry.
 */
function bumpRevision(rev: string | null): string {
  if (!rev) return '';
  const last = rev[rev.length - 1];
  if (/[a-yA-Y]/.test(last)) {
    return rev.slice(0, -1) + String.fromCharCode(last.charCodeAt(0) + 1);
  }
  if (/[0-8]/.test(last)) {
    return rev.slice(0, -1) + String.fromCharCode(last.charCodeAt(0) + 1);
  }
  if (last === '9') return rev.slice(0, -1) + '10';
  if (last === 'z' || last === 'Z') return rev + 'A';
  return '';
}

interface NewRevisionModalProps {
  parent: ProjectDocumentRow;
  onSubmit: (data: { title: string; code: string; category: string; revision: string; doc_date: string; microsoft?: MicrosoftReferenceInput }) => void;
  onClose: () => void;
  loading: boolean;
  readOnly?: boolean;
  /**
   * The LATEST Microsoft file (re-read just before opening), when the revision is made from a
   * changed-content file. It becomes the child's own reference; the parent's pin is never inherited.
   */
  microsoft?: MicrosoftReferenceInput | null;
}

/**
 * NewRevisionModal — creates a new Draft revision of a parent document.
 * Pre-fills title, code, category from the parent. Auto-bumps revision (A→B, 3→4).
 * File is NOT carried over. Create disabled until Title non-empty.
 */
export const NewRevisionModal: React.FC<NewRevisionModalProps> = ({
  parent,
  onSubmit,
  onClose,
  loading,
  readOnly = false,
  microsoft,
}) => {
  const { t } = useTranslation();
  const [title, setTitle] = useState(parent.title);
  const [code, setCode] = useState(parent.code ?? '');
  const [category, setCategory] = useState(parent.category);
  const [revision, setRevision] = useState(bumpRevision(parent.revision));
  const [docDate, setDocDate] = useState('');

  const canSubmit = title.trim().length > 0 && category.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly || !canSubmit) return;
    onSubmit({
      title: title.trim(),
      code: code.trim(),
      category: category.trim(),
      revision: revision.trim(),
      doc_date: docDate,
      ...(microsoft ? { microsoft } : {}),
    });
  };

  return (
    <EntityFormModal
      open
      title="New revision"
      subtitle={
        microsoft
          ? t('m365Documents.revisionLinkedSubtitle', 'Create the next revision of this document. It links to the latest Microsoft file, so there is nothing to upload.')
          : 'Create the next revision of this document. The file can be uploaded once the revision is created.'
      }
      submitLabel="Create revision"
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={loading}
      dirty={true}
      submitDisabled={readOnly || !canSubmit}
    >
      {parent.source === 'onedrive' && parent.status !== 'Draft' && parent.ms_item_kind === 'file' && (
        <div className="mb-3 flex min-w-0 flex-col gap-1" data-testid="revision-parent-summary">
          <DocumentDriftBadge
            status={parent.status}
            driftState={
              parent.ms_drift_state === 'clean' || parent.ms_drift_state === 'drifted' || parent.ms_drift_state === 'not_verified'
                ? parent.ms_drift_state
                : null
            }
            lastVerifiedAt={parent.ms_last_verified_at}
          />
          {microsoft && (
            <span className="break-words text-[12px] text-muted-foreground">
              {t('m365Documents.revisionLatestNote', 'The new revision will reference the latest Microsoft file: {{name}}.', { name: microsoft.name })}
            </span>
          )}
        </div>
      )}
      <FormSection legend="Revision details">
        <FormGrid>
          <TextField
            id="rev-title"
            label="Title"
            required
            value={title}
            onChange={setTitle}
            placeholder="Document title"
            fullWidth
          />
          <TextField
            id="rev-code"
            label="Code"
            mono
            value={code}
            onChange={setCode}
            placeholder="e.g. DWG-001"
          />
          <SelectField
            id="rev-category"
            label="Category"
            required
            value={category}
            onChange={setCategory}
            options={CATEGORY_OPTIONS}
          />
          <TextField
            id="rev-revision"
            label="Revision"
            value={revision}
            onChange={setRevision}
            placeholder="e.g. B"
          />
          <TextField
            id="rev-date"
            label="Document date"
            type="date"
            value={docDate}
            onChange={setDocDate}
          />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};
