import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import { DEFAULT_BILLING_KIND, type BillingKind } from '@/src/lib/billingKind';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import {
  Combobox,
  ConfirmDialog,
  EntityFormModal,
  FormGrid,
  SelectField,
  useEntityForm,
  type ComboboxOption,
  type SubmitError,
} from '@/src/components/ui';

export interface InvoiceProjectModalProps {
  invoice: SalesInvoiceRow;
  projects: ComboboxOption[];
  loadProjects: () => Promise<ComboboxOption[]>;
  currentProjectName: string | null;
  loading: boolean;
  onClose: () => void;
  /** #1471: the project and the billing kind are saved together. */
  onSave: (projectId: string, billingKind: BillingKind) => Promise<void>;
  /** A native or PMO-authored invoice cannot change project (the RPC refuses); only its billing kind is editable. */
  projectLocked?: boolean;
}

export function InvoiceProjectModal({
  invoice,
  projects,
  loadProjects,
  currentProjectName,
  loading,
  onClose,
  onSave,
  projectLocked = false,
}: InvoiceProjectModalProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const form = useEntityForm({
    initialValues: { projectId: invoice.project_id ?? '', billingKind: (invoice.billing_kind ?? DEFAULT_BILLING_KIND) as BillingKind },
    requiredFields: ['projectId'],
    validate: (values) => values.projectId ? {} : {
      projectId: t('invoiceProject.required', 'Select a project.'),
    },
    idPrefix: 'invoice-project',
  });
  const selected = projects.find((project) => project.value === form.values.projectId) ?? null;
  const busy = loading || saving;
  const unchanged = form.values.projectId === invoice.project_id
    && form.values.billingKind === (invoice.billing_kind ?? DEFAULT_BILLING_KIND);

  const save = async () => {
    if (inFlight.current || busy || !form.values.projectId || unchanged) return;
    inFlight.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(form.values.projectId, form.values.billingKind);
      onClose();
    } catch (error) {
      const classified = classifyMutationError(error);
      setSaveError({ headline: classified.headline, detail: classified.detail });
      setConfirming(false);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    void form.handleSubmit(async () => {
      // The project-change confirmation applies only when the project itself changes (a kind-only save needs none).
      if (invoice.project_id && form.values.projectId !== invoice.project_id) setConfirming(true);
      else await save();
    });
  };

  return <>
    <EntityFormModal
      open={!confirming}
      title={projectLocked
        ? t('invoiceProject.changeKind', 'Change billing kind')
        : invoice.project_id
          ? t('invoiceProject.change', 'Change project')
          : t('invoiceProject.assign', 'Assign project')}
      subtitle={`${invoice.si_number ?? ''} · ${t('invoiceProject.scope', 'PMO attribution only; the ERP invoice is unchanged.')}`}
      onClose={onClose}
      loading={busy}
      dirty={form.isDirty}
      submitError={saveError}
      submitLabel={projectLocked ? t('invoiceProject.saveKind', 'Save billing kind') : t('invoiceProject.save', 'Save project')}
      submitDisabled={!form.isComplete || unchanged}
      onSubmit={onSubmit}
      discardCopy={{
        title: t('invoiceProject.discardTitle', 'Discard project selection?'),
        description: t('invoiceProject.discardDetail', 'The selected project will not be saved.'),
        confirmLabel: t('invoiceProject.discard', 'Discard'),
        cancelLabel: t('invoiceProject.keep', 'Keep editing'),
      }}
    >
      <FormGrid>
        <Combobox
          label={t('invoiceProject.project', 'Project')}
          required
          id={form.fieldProps('projectId').id}
          value={form.values.projectId || null}
          selectedOption={selected}
          loadOptions={loadProjects}
          disabled={busy || projectLocked}
          error={form.errors.projectId}
          onChange={(value) => form.setValue('projectId', value)}
        />
        <SelectField
          id={form.fieldProps('billingKind').id}
          label={t('invoiceProject.kind.label', 'Billing kind')}
          value={form.values.billingKind}
          disabled={busy}
          options={[
            { value: 'contract', label: t('invoiceProject.kind.contract', 'Contract billing') },
            { value: 'other', label: t('invoiceProject.kind.other', 'Other billing') },
          ]}
          helper={form.values.billingKind === 'contract'
            ? t('invoiceProject.kind.contractHelp', 'Counts against the contract: reduces Remaining to invoice, and counts toward revenue and margin.')
            : t('invoiceProject.kind.otherHelp', 'Licences, reimbursables and work outside the contract: counts toward revenue and margin, never reduces Remaining to invoice.')}
          onChange={(value) => form.setValue('billingKind', value as BillingKind)}
        />
      </FormGrid>
    </EntityFormModal>
    <ConfirmDialog
      open={confirming}
      loading={busy}
      title={t('invoiceProject.change', 'Change project')}
      description={t('invoiceProject.fromTo', 'From {{old}} to {{new}}. PMO attribution only; the ERP invoice is unchanged.', {
        old: currentProjectName ?? t('invoiceProject.current', 'Current project'),
        new: selected?.label ?? t('projectFinances.unavailable', 'Unavailable'),
      })}
      confirmLabel={t('invoiceProject.change', 'Change project')}
      onConfirm={() => void save()}
      onCancel={() => setConfirming(false)}
    />
  </>;
}
