import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import {
  Combobox,
  ConfirmDialog,
  EntityFormModal,
  FormGrid,
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
  onSave: (projectId: string) => Promise<void>;
}

export function InvoiceProjectModal({
  invoice,
  projects,
  loadProjects,
  currentProjectName,
  loading,
  onClose,
  onSave,
}: InvoiceProjectModalProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const form = useEntityForm({
    initialValues: { projectId: invoice.project_id ?? '' },
    requiredFields: ['projectId'],
    validate: (values) => values.projectId ? {} : {
      projectId: t('invoiceProject.required', 'Select a project.'),
    },
    idPrefix: 'invoice-project',
  });
  const selected = projects.find((project) => project.value === form.values.projectId) ?? null;
  const busy = loading || saving;
  const unchanged = form.values.projectId === invoice.project_id;

  const save = async () => {
    if (inFlight.current || busy || !form.values.projectId || unchanged) return;
    inFlight.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(form.values.projectId);
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
      if (invoice.project_id) setConfirming(true);
      else await save();
    });
  };

  return <>
    <EntityFormModal
      open={!confirming}
      title={invoice.project_id
        ? t('invoiceProject.change', 'Change project')
        : t('invoiceProject.assign', 'Assign project')}
      subtitle={`${invoice.si_number ?? ''} · ${t('invoiceProject.scope', 'PMO attribution only; the ERP invoice is unchanged.')}`}
      onClose={onClose}
      loading={busy}
      dirty={form.isDirty}
      submitError={saveError}
      submitLabel={t('invoiceProject.save', 'Save project')}
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
          disabled={busy}
          error={form.errors.projectId}
          onChange={(value) => form.setValue('projectId', value)}
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
