import React, { useCallback } from 'react';
import {
  EntityFormModal,
  TextField,
  Combobox,
  FormSection,
  FormGrid,
  useEntityForm,
  type ComboboxOption,
} from '@/src/components/ui';
import { useProjectOptions, useVendorOptions } from '@/src/hooks/useFkOptions';
import type { NewProcurementInput } from '@/src/lib/db/procurementCrud';

// ---------------------------------------------------------------------------
// NewProcurementModal — "Raise a purchase request" create form (crud-components
// §9.3 / crud-procurement-new-pr.html). A focused EntityFormModal: title
// (required), a project FK Combobox, and an optional vendor FK Combobox. Line
// items / quotations / documents are added on the detail page AFTER the PR
// exists (they need its id) — the caller navigates there on success.
//
// Available to ANY member incl. Engineer (requester server-stamped by the hook);
// the index gates the launch button via can('create','procurement').
// Token-pure: it composes only the shared form primitives.
// ---------------------------------------------------------------------------

interface FormValues {
  title: string;
  projectId: string | null;
  vendorId: string | null;
}

const validate = (v: FormValues): Partial<Record<keyof FormValues, string>> => {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!v.title.trim()) errors.title = 'A request title is required.';
  return errors;
};

export interface NewProcurementModalProps {
  onClose: () => void;
  /** Persists the new PR (Draft, requester stamped) and returns its id. */
  onCreate: (input: NewProcurementInput) => Promise<{ id: string }>;
  /** Surfaced a classified mutation error. */
  onError: (err: unknown) => void;
  /** Called with the new PR id after a successful create (caller navigates). */
  onCreated: (id: string) => void;
}

export const NewProcurementModal: React.FC<NewProcurementModalProps> = ({
  onClose,
  onCreate,
  onError,
  onCreated,
}) => {
  const form = useEntityForm<FormValues>({
    initialValues: { title: '', projectId: null, vendorId: null },
    validate,
    idPrefix: 'new-pr',
    // F8 (AC-IXD-FORM-F8): submit stays disabled until the required title is present.
    requiredFields: ['title'],
  });

  const title = form.fieldProps('title');

  // FK options come from the cached hooks ("hooks own data fetching"); the
  // Combobox loader just hands back the already-fetched list (no re-fetch on
  // popover open — this is what fixes the empty-picker flake).
  const { data: projectOptions } = useProjectOptions();
  const { data: vendorOptions } = useVendorOptions();
  const loadProjects = useCallback(
    async (): Promise<ComboboxOption[]> => projectOptions ?? [],
    [projectOptions],
  );
  const loadVendors = useCallback(
    async (): Promise<ComboboxOption[]> => vendorOptions ?? [],
    [vendorOptions],
  );

  const errorSummary = form.errors.title
    ? [{ fieldId: title.id, message: form.errors.title }]
    : undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      try {
        const created = await onCreate({
          title: values.title.trim(),
          projectId: values.projectId,
          vendorId: values.vendorId,
        });
        onCreated(created.id);
      } catch (err) {
        onError(err);
      }
    });
  };

  return (
    <EntityFormModal
      open
      title="Raise a purchase request"
      subtitle="Anyone can raise a request; you are recorded as the requester. Add line items and quotations on the next screen."
      submitLabel="Create request"
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary}
    >
      <FormSection legend="Request details">
        <FormGrid>
          <TextField
            id={title.id}
            label="Title"
            required
            value={title.value}
            onChange={title.onChange}
            onBlur={title.onBlur}
            error={title.error}
            placeholder="e.g. Welding consumables — Q3 restock"
            fullWidth
          />
          <Combobox
            label="Project"
            noun="project"
            placeholder="Select a project…"
            value={form.values.projectId}
            onChange={(v) => form.setValue('projectId', v)}
            loadOptions={loadProjects}
          />
          <Combobox
            label="Vendor"
            noun="vendor"
            placeholder="Optional — select a vendor…"
            value={form.values.vendorId}
            onChange={(v) => form.setValue('vendorId', v)}
            loadOptions={loadVendors}
          />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

NewProcurementModal.displayName = 'NewProcurementModal';
