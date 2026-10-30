import { isMicrosoftFolder } from './documentUtils';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { EntityFormModal, TextField, SelectField, FormSection, FormGrid, useEntityForm, Button, Icon, type SubmitError } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { CATEGORY_OPTIONS } from '@/src/lib/documentCategories';
import type { ProjectDocumentRow, ProjectDocumentInput } from '@/src/lib/db/documents';
import type { MicrosoftReferenceInput } from '@/src/lib/m365/reference';


interface FormValues {
  title: string;
  code: string;
  category: string;
  revision: string;
  doc_date: string;
}

const validate = (v: FormValues, t: TFunction, isFolder = false): Partial<Record<keyof FormValues, string>> => {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!v.title.trim())
    errors.title = t('projectDetail.documents.form.errors.titleRequired', 'Title is required.');
  if (!isFolder && !v.category.trim())
    errors.category = t(
      'projectDetail.documents.form.errors.categoryRequired',
      'Category is required.',
    );
  return errors;
};

/** A file's title starts from its name without the extension; a folder keeps its whole name. Still editable. */
const seedTitle = (reference: MicrosoftReferenceInput): string =>
  reference.item_kind === 'folder' ? reference.name : reference.name.replace(/\.[A-Za-z0-9]{1,5}$/, '');

interface DocumentFormModalProps {
  doc: ProjectDocumentRow | null;
  /** A Microsoft reference chosen first; the title is seeded from its name but stays editable. */
  reference?: MicrosoftReferenceInput;
  /** Reopens the Microsoft picker so the chosen item can be swapped before saving. */
  onChangeReference?: () => void;
  readOnly?: boolean;
  onClose: () => void;
  onCreate: (input: ProjectDocumentInput) => Promise<void>;
  onUpdate: (id: string, input: ProjectDocumentInput) => Promise<void>;
  onError: (err: unknown) => void;
}

export const DocumentFormModal: React.FC<DocumentFormModalProps> = ({
  doc,
  reference,
  onChangeReference,
  readOnly = false,
  onClose,
  onCreate,
  onUpdate,
  onError,
}) => {
  const { t } = useTranslation('project');
  const { t: tf } = useTranslation('recordFolders');
  const isEdit = !!doc;
  // A folder is a reference, not a register document: it has no category, revision, code or date.
  const isFolder = reference ? reference.item_kind === 'folder' : !!doc && isMicrosoftFolder(doc);
  // Memoised on `t` so the validator identity is stable between renders.
  const validateWithT = useCallback((v: FormValues) => validate(v, t, isFolder), [t, isFolder]);
  const form = useEntityForm<FormValues>({
    initialValues: {
      title: doc?.title ?? (reference ? seedTitle(reference) : ''),
      code: doc?.code ?? '',
      category: doc?.category ?? (isFolder ? 'Reference' : 'Drawing'),
      revision: doc?.revision ?? '',
      doc_date: doc?.doc_date ?? '',
    },
    validate: validateWithT,
    idPrefix: 'document-form',
    module: 'projects',
    // F8 (AC-IXD-FORM-F8): submit stays disabled until the required title + category
    // are present (category defaults to a value, so the title is the live gate).
    requiredFields: isFolder ? ['title'] : ['title', 'category'],
  });

  const titleField = form.fieldProps('title');
  const codeField = form.fieldProps('code');
  const categoryField = form.fieldProps('category');
  const revisionField = form.fieldProps('revision');
  const dateField = form.fieldProps('doc_date');

  const errorSummary = [
    form.errors.title ? { fieldId: titleField.id, message: form.errors.title } : null,
    form.errors.category ? { fieldId: categoryField.id, message: form.errors.category } : null,
  ].filter(Boolean) as { fieldId: string; message: string }[];

  // #559 / AC-ERR-001: a rejected save must leave PERSISTENT evidence in the dialog. The toast
  // auto-dismisses after 4s, ~700px from where the user is looking, after which the modal is
  // indistinguishable from a pristine form with data in it — so the save looks like it worked.
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      const input: ProjectDocumentInput = {
        title: values.title.trim(),
        code: values.code.trim(),
        category: values.category,
        revision: values.revision.trim(),
        doc_date: values.doc_date,
      };
      try {
        if (isEdit && doc) await onUpdate(doc.id, input);
        else await onCreate(input);
      } catch (err) {
        // `suppressCapture` only: the page's own `onError` classifies this same rejection for the
        // toast and owns the single `save_failed` event (ADR-0067).
        const { headline, detail } = classifyMutationError(err, undefined, { suppressCapture: true });
        setSaveError({ headline, detail });
        onError(err);
      }
    });
  };

  return (
    <EntityFormModal
      open
      title={
        isEdit
          ? t('projectDetail.documents.form.editTitle', 'Edit document')
          : t('projectDetail.documents.addDocument', 'Add document')
      }
      subtitle={
        isEdit
          ? t('projectDetail.documents.form.editSubtitle', 'Update this register entry')
          : reference
            ? isFolder
              ? tf('folderFiles.linkedFolderSubtitle', 'Link this folder to the project. Its files stay in Microsoft 365.')
              : t('m365Documents.docsTab.linkedSubtitle', 'Record a drawing, specification, or transmittal. Its file stays in Microsoft 365.')
            : t(
                'projectDetail.documents.form.newSubtitle',
                'Record a drawing, specification, or transmittal. Upload a file once the Draft row is created.',
              )
      }
      submitLabel={
        isEdit
          ? t('projectDetail.documents.form.save', 'Save document')
          : t('projectDetail.documents.addDocument', 'Add document')
      }
      onSubmit={handleSubmit}
      submitError={saveError}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty || !!reference}
      submitDisabled={readOnly || !form.isComplete}
      errorSummary={errorSummary.length ? errorSummary : undefined}
    >
      {reference && (
        <div data-testid="document-linked-item" className="mb-3 flex min-w-0 items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13px]">
          <Icon name={reference.item_kind === 'folder' ? 'folder' : 'doc'} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 break-words font-medium text-foreground" title={reference.name}>{reference.name}</span>
          {onChangeReference && (
            <Button type="button" variant="ghost" size="sm" onClick={onChangeReference}>
              {t('m365Documents.docsTab.change', 'Change')}
            </Button>
          )}
        </div>
      )}
      <FormSection legend={t('projectDetail.documents.form.legend', 'Document')}>
        <FormGrid>
          <TextField
            id={titleField.id}
            label={t('projectDetail.documents.form.title', 'Title')}
            required
            value={titleField.value}
            onChange={titleField.onChange}
            onBlur={titleField.onBlur}
            error={titleField.error}
            placeholder={t('projectDetail.documents.form.titlePlaceholder', 'e.g. Foundation general arrangement')}
            fullWidth
          />
          {!isFolder && (
            <>
            <TextField
              id={codeField.id}
              label={t('projectDetail.documents.form.code', 'Code')}
              mono
              value={codeField.value}
              onChange={codeField.onChange}
              onBlur={codeField.onBlur}
              placeholder={t('projectDetail.documents.form.codePlaceholder', 'e.g. DWG-001')}
              helper={t(
                'projectDetail.documents.form.codeHelper',
                'Optional document number or drawing code.',
              )}
            />
            <SelectField
              id={categoryField.id}
              label={t('projectDetail.documents.form.category', 'Category')}
              required
              value={categoryField.value}
              onChange={categoryField.onChange}
              onBlur={categoryField.onBlur}
              error={categoryField.error}
              options={CATEGORY_OPTIONS}
            />
            <TextField
              id={revisionField.id}
              label={t('projectDetail.documents.form.revision', 'Revision')}
              value={revisionField.value}
              onChange={revisionField.onChange}
              onBlur={revisionField.onBlur}
              placeholder={t('projectDetail.documents.form.revisionPlaceholder', 'e.g. A')}
            />
            <TextField
              id={dateField.id}
              label={t('projectDetail.documents.form.docDate', 'Document date')}
              type="date"
              value={dateField.value}
              onChange={dateField.onChange}
              onBlur={dateField.onBlur}
            />
            </>
          )}
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};
