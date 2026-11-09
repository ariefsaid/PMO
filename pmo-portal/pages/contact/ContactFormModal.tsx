import { contactIdentityChanged } from '@/src/lib/crmOwnership';
import React, { useMemo, useState } from 'react';
import {
  EntityFormModal,
  TextField,
  TextArea,
  SelectField,
  FormSection,
  FormGrid,
  Button,
  useEntityForm,
  type SubmitError,
} from '@/src/components/ui';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { ContactRow, ContactInput } from '@/src/lib/db/contacts';

/**
 * The ONE contact create/edit form (PGA02-005 / OE02R01-001): the directory's former
 * ContactFormModal, now also the contact record page's edit modal and the company record page's
 * in-context "Add contact" modal. Fields, validation, input normalization, mirror/ownership
 * gating and persistent submit-error handling live here once, so a contact-field change can
 * never behave differently by entry point.
 *
 * Modes:
 *  - create (contact=null) and edit — company chosen from `companyOptions`;
 *  - locked company (lockedCompanyId) — in-context create from a company record: company_id
 *    pre-filled and locked, shown as a disabled select whose accessible name stays "Company";
 *  - mirror read-only (ownership='external') — ERP-managed fields disabled and mirrored.
 *
 * PGA02-004: the company directory behind `companyOptions` can be pending or failed. The form
 * gates the company choice (and the submit) behind that state — a transient directory failure
 * must never present an unexplained empty select — with a retry via `onRetryCompanies`. The
 * locked-company mode needs no directory: the company is already known.
 */

interface FormValues {
  full_name: string;
  company_id: string;
  title: string;
  email: string;
  phone: string;
  notes: string;
}

/**
 * `t` has to be threaded in: both messages are user-visible, and a module-level literal cannot
 * reach the active locale. The validation SHAPE is unchanged — same fields, same trigger, same keys.
 */
const makeValidate =
  (t: TFunction) =>
  (v: FormValues): Partial<Record<keyof FormValues, string>> => {
    const errors: Partial<Record<keyof FormValues, string>> = {};
    if (!v.full_name.trim())
      errors.full_name = t('contacts.form.errors.nameRequired', 'Contact name is required.');
    if (!v.company_id)
      errors.company_id = t('contacts.form.errors.companyRequired', 'A company is required.');
    return errors;
  };

export type CompanyOptionsState = 'ready' | 'pending' | 'error';

export interface ContactFormModalProps {
  /** Null = create mode. */
  contact: ContactRow | null;
  ownership: 'pmo' | 'external' | 'unknown' | 'error';
  companyOptions: { value: string; label: string }[];
  /** PGA02-004: readiness of the directory behind `companyOptions` (default 'ready'). */
  companyOptionsState?: CompanyOptionsState;
  /** PGA02-004: retry for a failed directory read (rendered beside the company field). */
  onRetryCompanies?: () => void;
  /** In-context create from a company record: company_id pre-filled and locked (OE02R01-002's
   *  former dead prop, now with a real caller). */
  lockedCompanyId?: string;
  /** Display name for the locked company's select option. */
  lockedCompanyLabel?: string;
  /** Create-mode subtitle override (the company-record surface says "at this company"). */
  createSubtitle?: string;
  onClose: () => void;
  /** The create-mode callback (required when `contact` is null). */
  onCreate?: (input: ContactInput) => Promise<void>;
  /** The edit-mode callback (required when `contact` is set). */
  onUpdate?: (id: string, input: ContactInput) => Promise<void>;
  onError: (err: unknown) => void;
}

export const ContactFormModal: React.FC<ContactFormModalProps> = ({
  contact,
  ownership,
  companyOptions,
  companyOptionsState = 'ready',
  onRetryCompanies,
  lockedCompanyId,
  lockedCompanyLabel,
  createSubtitle,
  onClose,
  onCreate,
  onUpdate,
  onError,
}) => {
  const { t } = useTranslation();
  const isEdit = !!contact;
  const ready = ownership === 'pmo' || ownership === 'external';
  const mirrorReadOnly = !ready || (isEdit && ownership === 'external');
  // Identity changes only when `t` does (i.e. on a language change), so `useEntityForm`'s
  // `runValidate` memo behaves exactly as it did with the old module-level function.
  const validate = useMemo(() => makeValidate(t), [t]);
  const locked = lockedCompanyId ?? null;
  const directoryBlocked = !locked && (companyOptionsState === 'pending' || companyOptionsState === 'error');
  const form = useEntityForm<FormValues>({
    initialValues: {
      full_name: contact?.full_name ?? '',
      // OE02R01-002: company_id initializes from the contact, the locked in-context company,
      // or empty — never from a phantom default.
      company_id: contact?.company_id ?? locked ?? '',
      title: contact?.title ?? '',
      email: contact?.email ?? '',
      phone: contact?.phone ?? '',
      notes: contact?.notes ?? '',
    },
    validate,
    idPrefix: 'contact-form',
    requiredFields: ['full_name', 'company_id'],
    module: 'contacts',
  });

  const nameField = form.fieldProps('full_name');
  const companyField = form.fieldProps('company_id');
  const titleField = form.fieldProps('title');
  const emailField = form.fieldProps('email');
  const phoneField = form.fieldProps('phone');
  const notesField = form.fieldProps('notes');

  // AC-ERR-001: a rejected save gets PERSISTENT in-dialog evidence, not only the corner
  // toast (which auto-dismisses, leaving the modal indistinguishable from a pristine form
  // with data in it). `suppressCapture` because the page's `onError` classifies the same
  // rejection for the toast and owns the single `save_failed` event.
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const errorSummary = [
    form.errors.full_name ? { fieldId: nameField.id, message: form.errors.full_name } : null,
    form.errors.company_id ? { fieldId: companyField.id, message: form.errors.company_id } : null,
  ].filter(Boolean) as { fieldId: string; message: string }[];
  const identityChanged = mirrorReadOnly && contact !== null && contactIdentityChanged(form.values, contact);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      if (!ready || (mirrorReadOnly && contact && contactIdentityChanged(values, contact))
        || (!isEdit && !locked && !companyOptions.some((option) => option.value === values.company_id))) return;
      const input: ContactInput = {
        company_id: mirrorReadOnly ? contact!.company_id : values.company_id,
        full_name: mirrorReadOnly ? contact!.full_name : values.full_name.trim(),
        title: values.title.trim() || null,
        email: mirrorReadOnly ? contact!.email : values.email.trim() || null,
        phone: mirrorReadOnly ? contact!.phone : values.phone.trim() || null,
        notes: values.notes.trim() || null,
      };
      try {
        if (isEdit && contact) await onUpdate?.(contact.id, input);
        else await onCreate?.(input);
      } catch (err) {
        const { headline, detail } = classifyMutationError(err, undefined, {
          module: 'contacts',
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
          ? t('contacts.form.editTitle', 'Edit contact')
          : t('contacts.form.newTitle', 'New contact')
      }
      subtitle={
        isEdit
          ? t('contacts.form.editSubtitle', 'Update this contact record')
          : createSubtitle ?? t('contacts.form.newSubtitle', 'Add a person at one of your companies')
      }
      submitLabel={
        isEdit
          ? t('contacts.form.editSubmit', 'Save contact')
          : t('contacts.form.newSubmit', 'Create contact')
      }
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete || !ready || identityChanged || directoryBlocked || (!isEdit && !locked && !companyOptions.some((option) => option.value === form.values.company_id))}
      errorSummary={errorSummary.length ? errorSummary : undefined}
      submitError={saveError}
    >
      {identityChanged && <p className="mb-3 text-sm text-muted-foreground">{t('crm:ownershipChanged', 'Ownership changed while you were editing. Close and reopen the form to continue.')}</p>}
      {mirrorReadOnly && <p className="mb-3 text-sm text-muted-foreground">{t('crm:mirrorFields', 'Name, company, email and phone are managed in ERP.')}</p>}
      <FormSection legend={t('contacts.form.sections.identity', 'Identity')}>
        <FormGrid>
          <TextField
            disabled={mirrorReadOnly}
            id={nameField.id}
            label={t('contacts.form.fullName.label', 'Full name')}
            required
            value={nameField.value}
            onChange={nameField.onChange}
            onBlur={nameField.onBlur}
            error={nameField.error}
            placeholder={t('contacts.form.fullName.placeholder', 'e.g. Jane Doe')}
            autoComplete="name"
            fullWidth
          />
          {locked ? (
            /* Company is locked (in-context create) — a disabled select so the accessible name
               "Company" is present and the value is visually clear; the single option carries
               the company for the form value. */
            <SelectField
              id="contact-form-company"
              label={t('contacts.form.company.label', 'Company')}
              required
              value={lockedCompanyId!}
              onChange={() => { /* locked */ }}
              options={[{ value: lockedCompanyId!, label: lockedCompanyLabel ?? lockedCompanyId! }]}
              disabled
            />
          ) : (
            <div>
              <SelectField
                id={companyField.id}
                label={t('contacts.form.company.label', 'Company')}
                required
                value={companyField.value}
                onChange={(v) => companyField.onChange(v)}
                onBlur={companyField.onBlur}
                error={companyField.error}
                options={[
                  { value: '', label: t('contacts.form.company.placeholder', 'Select a company…') },
                  ...(companyOptionsState === 'pending'
                    ? [{ value: 'pending', label: t('contacts.form.company.loading', 'Loading companies…'), disabled: true }]
                    : []),
                  ...(companyOptionsState === 'error'
                    ? [{ value: 'error', label: t('contacts.form.company.loadFailed', 'Companies could not be loaded.'), disabled: true }]
                    : []),
                  ...companyOptions,
                ]}
                disabled={mirrorReadOnly || companyOptionsState !== 'ready'}
              />
              {companyOptionsState === 'error' && onRetryCompanies && (
                <div className="mt-1.5 flex items-center gap-2">
                  <p className="text-[12px] text-muted-foreground">{t('contacts.form.company.loadFailed', 'Companies could not be loaded.')}</p>
                  <Button variant="outline" size="sm" onClick={onRetryCompanies}>
                    {t('crm:retry', 'Retry')}
                  </Button>
                </div>
              )}
            </div>
          )}
          <TextField
            id={titleField.id}
            label={t('contacts.form.jobTitle.label', 'Title')}
            value={titleField.value}
            onChange={titleField.onChange}
            onBlur={titleField.onBlur}
            placeholder={t('contacts.form.jobTitle.placeholder', 'e.g. Procurement Lead')}
            autoComplete="organization-title"
          />
        </FormGrid>
      </FormSection>
      <FormSection legend={t('contacts.form.sections.contactDetails', 'Contact details')}>
        <FormGrid>
          <TextField
            disabled={mirrorReadOnly}
            id={emailField.id}
            label={t('contacts.form.email.label', 'Email')}
            type="email"
            value={emailField.value}
            onChange={emailField.onChange}
            onBlur={emailField.onBlur}
            placeholder="name@example.com"
            autoComplete="off"
          />
          <TextField
            disabled={mirrorReadOnly}
            id={phoneField.id}
            label={t('contacts.form.phone.label', 'Phone')}
            type="tel"
            value={phoneField.value}
            onChange={phoneField.onChange}
            onBlur={phoneField.onBlur}
            placeholder={t('contacts.form.phone.placeholder', 'e.g. +1 555 010 0000')}
            autoComplete="tel"
          />
          <TextArea
            id={notesField.id}
            label={t('contacts.form.notes.label', 'Notes')}
            value={notesField.value}
            onChange={notesField.onChange}
            onBlur={notesField.onBlur}
            rows={3}
            fullWidth
            placeholder={t(
              'contacts.form.notes.placeholder',
              'Anything worth remembering about this contact',
            )}
          />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};
