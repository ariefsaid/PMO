import { companyIdentityChanged } from '@/src/lib/crmOwnership';
import React, { useMemo, useState } from 'react';
import {
  EntityFormModal,
  TextField,
  SelectField,
  FormSection,
  FormGrid,
  useEntityForm,
  type SubmitError,
} from '@/src/components/ui';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { typeLabels } from './companyTypeLabels';
import type { CompanyListRow, CompanyType, CompanyInput } from '@/src/lib/db/companies';
import { TaskPushBadge } from '@/src/components/tasks/TaskPushBadge';
import { IDLE_PENDING_PUSH, type PendingPushState } from '@/src/lib/adapterSeam/pendingPush';

/**
 * The ONE company create/edit form (PGA02-003 / OE01-005): the directory's former
 * CompanyFormModal, now also the record page's edit modal. Field mapping, normalization,
 * external-ownership gating, identity-changed guard, pending-push badge and persistent
 * submit-error handling live here so a company-field or edit-rule change can never be
 * reconciled across two forms (or missed on one surface).
 */

interface FormValues {
  name: string;
  short_name: string;
  type: CompanyType;
  clientNumberSegment: string;
}

/**
 * `t` has to be threaded in: the message is user-visible, and a module-level literal cannot reach
 * the active locale. The validation SHAPE is unchanged — same fields, same trigger, same keys.
 */
const makeValidate =
  (t: TFunction) =>
  (v: FormValues): Partial<Record<keyof FormValues, string>> => {
    const errors: Partial<Record<keyof FormValues, string>> = {};
    if (!v.name.trim())
      errors.name = t('companies.form.errors.nameRequired', 'Company name is required.');
    return errors;
  };

function ownershipReadyForForm(mode: CompanyFormModalProps['ownership']) { return mode === 'pmo' || mode === 'external'; }

/**
 * Outcome of the caller's edit save. PGA02-001: the record save and the client-number segment
 * save are two sequential mutations — when the SEGMENT fails after the company row committed,
 * the caller reports `segmentSaveError` and this form states the PARTIAL truth in-dialog
 * (persistent, AC-ERR-001) instead of reporting the whole save as failed.
 */
export interface CompanySaveOutcome {
  segmentSaveError?: unknown;
}

export interface CompanyFormModalProps {
  /** Null = create mode. */
  /** The row may come from the server-paged directory (#1989) or a full record read — the form reads only the directory projection. */
  company: CompanyListRow | null;
  ownership: 'pmo' | 'external' | 'unknown' | 'error';
  /** ADR-0056/FR-EAS-060..063 pending-push state for a flipped org's Vendor/Client write (directory only). */
  pendingPush?: PendingPushState;
  onClose: () => void;
  onCreate?: (input: CompanyInput) => Promise<void>;
  onUpdate: (id: string, input: CompanyInput, segment: string | null) => Promise<CompanySaveOutcome | void>;
  onError: (err: unknown) => void;
}

export const CompanyFormModal: React.FC<CompanyFormModalProps> = ({
  company,
  ownership,
  pendingPush = IDLE_PENDING_PUSH,
  onClose,
  onCreate,
  onUpdate,
  onError,
}) => {
  const { t } = useTranslation();
  const isEdit = !!company;
  const nativeReadOnly = !ownershipReadyForForm(ownership) || (isEdit && company.type !== 'Internal' && ownership === 'external');
  // Identity changes only when `t` does (i.e. on a language change), so `useEntityForm`'s
  // `runValidate` memo behaves exactly as it did with the old module-level function.
  const validate = useMemo(() => makeValidate(t), [t]);
  const typeOptions = useMemo(() => {
    const labels = typeLabels(t);
    return [
      { value: 'Client', label: labels.Client },
      { value: 'Vendor', label: labels.Vendor },
      ...(!isEdit && ownership === 'external' ? [] : [{ value: 'Internal', label: labels.Internal }]),
    ];
  }, [t, isEdit, ownership]);
  const form = useEntityForm<FormValues>({
    initialValues: { name: company?.name ?? '', short_name: company?.short_name ?? '', type: company?.type ?? 'Client', clientNumberSegment: company?.client_number_segment ?? '' },
    validate,
    idPrefix: 'company-form',
    // F8 (AC-IXD-FORM-F8): submit stays disabled until the required name is present.
    requiredFields: ['name'],
    module: 'companies',
  });

  const nameField = form.fieldProps('name');
  const shortNameField = form.fieldProps('short_name');
  const typeField = form.fieldProps('type');
  const clientNumberSegmentField = form.fieldProps('clientNumberSegment');

  // AC-ERR-001: a rejected save gets PERSISTENT in-dialog evidence, not only the corner
  // toast (which auto-dismisses, leaving the modal indistinguishable from a pristine form
  // with data in it). `suppressCapture` because the page's `onError` classifies the same
  // rejection for the toast and owns the single `save_failed` event.
  const [saveError, setSaveError] = useState<SubmitError | null>(null);
  // PGA02-001: a PARTIAL save (company row committed, segment write failed) gets its own
  // persistent warning — distinct from the total-failure block, which would wrongly claim
  // "Nothing was saved".
  const [partialSave, setPartialSave] = useState<SubmitError | null>(null);

  const errorSummary = form.errors.name
    ? [{ fieldId: nameField.id, message: form.errors.name }]
    : undefined;
  const identityChanged = ownership === 'external' && company !== null && companyIdentityChanged(form.values, company);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      if (!ownershipReadyForForm(ownership) || (!isEdit && ownership === 'external' && values.type === 'Internal')
        || (ownership === 'external' && company && companyIdentityChanged(values, company))) return;
      const input: CompanyInput = {
        name: nativeReadOnly && company ? company.name : values.name.trim(),
        type: values.type,
        ...(nativeReadOnly || values.short_name.trim() || company?.short_name
          ? { short_name: values.short_name.trim() || null }
          : {}),
      };
      try {
        if (isEdit && company) {
          const outcome = await onUpdate(company.id, input, values.clientNumberSegment.trim() || null);
          // PGA02-001: the company row committed but the follow-up segment write failed. State the
          // partial truth in a persistent in-dialog notice and keep the modal open for a segment
          // retry — the name/type change is NOT rolled back by closing (or by a generic
          // "nothing was saved" error that misstates what already happened).
          if (outcome && 'segmentSaveError' in outcome && outcome.segmentSaveError) {
            const { detail } = classifyMutationError(outcome.segmentSaveError, undefined, {
              module: 'companies',
              operation: 'update',
              suppressCapture: true,
            });
            setPartialSave({
              headline: t('companies.form.partialSave.headline', 'Company saved, but one change did not persist'),
              detail: `${t('companies.form.partialSave.segmentDetail', 'The client-number segment could not be saved. Review it and save again.')} ${detail}`,
            });
            onError(outcome.segmentSaveError);
            return;
          }
        } else if (onCreate) {
          await onCreate(input);
        } else {
          return;
        }
        setPartialSave(null);
        setSaveError(null);
      } catch (err) {
        const { headline, detail } = classifyMutationError(err, undefined, {
          module: 'companies',
          operation: isEdit ? 'update' : 'create',
          suppressCapture: true,
        });
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
          ? t('companies.form.editTitle', 'Edit company')
          : t('companies.form.newTitle', 'New company')
      }
      subtitle={
        isEdit
          ? t('companies.form.editSubtitle', 'Update this company record')
          : t('companies.form.newSubtitle', 'Add a client or supplier to the directory')
      }
      submitLabel={
        isEdit
          ? t('companies.form.editSubmit', 'Save company')
          : t('companies.form.newSubmit', 'Create company')
      }
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete || !ownershipReadyForForm(ownership) || identityChanged || (!isEdit && ownership === 'external' && form.values.type === 'Internal')}
      errorSummary={errorSummary}
      submitError={saveError}
    >
      {identityChanged && <p className="mb-3 text-sm text-muted-foreground">{t('crm:ownershipChanged', 'Ownership changed while you were editing. Close and reopen the form to continue.')}</p>}
      {partialSave && (
        <div
          data-testid="company-partial-save"
          role="alert"
          aria-label={partialSave.headline}
          className="mb-4 flex gap-2.5 rounded-md border border-warning/40 bg-warning/[0.07] px-3.5 py-3"
        >
          <div className="min-w-0">
            <div className="text-control font-semibold">{partialSave.headline}</div>
            <p className="text-support text-muted-foreground">{partialSave.detail}</p>
          </div>
        </div>
      )}
      {pendingPush.status !== 'idle' && (
        <div className="mb-3.5 flex justify-end">
          <TaskPushBadge state={pendingPush} />
        </div>
      )}
      <FormSection legend={t('companies.form.sections.identity', 'Identity')}>
        <FormGrid>
          <TextField
            disabled={nativeReadOnly}
            id={nameField.id}
            label={t('companies.form.name.label', 'Company name')}
            required
            value={nameField.value}
            onChange={nameField.onChange}
            onBlur={nameField.onBlur}
            error={nameField.error}
            placeholder={t('companies.form.name.placeholder', 'e.g. Cascade Port Authority')}
            autoComplete="organization"
            fullWidth
          />
          <TextField
            id={shortNameField.id}
            label={t('companies.form.shortName.label', 'Short name')}
            helper={t('companies.form.shortName.hint', 'Optional display name used across PMO. The legal name stays unchanged.')}
            value={shortNameField.value}
            onChange={shortNameField.onChange}
            onBlur={shortNameField.onBlur}
            fullWidth
          />
          <SelectField
            disabled={nativeReadOnly || (isEdit && ownership === 'external')}
            id={typeField.id}
            label={t('companies.form.type.label', 'Type')}
            required
            value={typeField.value}
            onChange={(v) => typeField.onChange(v as CompanyType)}
            onBlur={typeField.onBlur}
            options={typeOptions}
          />
          {!isEdit && ownership === 'external' && form.values.type === 'Internal' && <p className="text-sm text-muted-foreground">{t('crm:chooseParty', 'Choose a client or supplier to continue.')}</p>}
          {isEdit && (
            <TextField
              id={clientNumberSegmentField.id}
              label={t('companies.form.clientNumberSegment.label', 'Client number segment')}
              value={clientNumberSegmentField.value}
              onChange={clientNumberSegmentField.onChange}
              onBlur={clientNumberSegmentField.onBlur}
              placeholder={t('companies.form.clientNumberSegment.placeholder', 'e.g. RIS')}
              mono
            />
          )}
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};
