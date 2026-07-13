import React, { useCallback, useEffect } from 'react';
import {
  Card,
  CardHead,
  CardPad,
  TextField,
  Combobox,
  FormGrid,
  FormActions,
  useEntityForm,
  type ComboboxOption,
} from '@/src/components/ui';
import { useProjectOptions, useVendorOptions } from '@/src/hooks/useFkOptions';
import type { ProcurementHeaderPatch } from '@/src/lib/db/procurementCrud';

// ---------------------------------------------------------------------------
// ProcurementHeaderEdit — the Draft-header edit panel (crud-components §3 inline
// detail-header edit, §9.3 "edit while Draft/Rejected"). CW-3a: the Edit affordance
// now lives in the canonical RecordHeader action zone; this panel is CONTROLLED by
// the host (`onClose`) and renders the editable header fields (title + project +
// vendor) directly with Save/Cancel. Inline rather than a giant modal-over-page.
//
// Backed by `useEntityForm` (matches NewProcurementModal): one controlled-form
// helper owns values / dirty / submit / per-field validation, so the title-required
// rule and the disabled-Save state are the shared form contract, not ad-hoc state.
// Token-pure (Card / form primitives).
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

export interface ProcurementHeaderEditProps {
  title: string;
  projectId: string | null;
  projectName: string | null;
  vendorId: string | null;
  vendorName: string | null;
  onSave: (patch: ProcurementHeaderPatch) => Promise<unknown>;
  onError: (err: unknown) => void;
  /** Host-controlled close (the panel is opened from the RecordHeader Edit action). */
  onClose: () => void;
  busy?: boolean;
}

export const ProcurementHeaderEdit: React.FC<ProcurementHeaderEditProps> = ({
  title,
  projectId,
  projectName,
  vendorId,
  vendorName,
  onSave,
  onError,
  onClose,
  busy,
}) => {
  const form = useEntityForm<FormValues>({
    initialValues: { title, projectId, vendorId },
    validate,
    idPrefix: 'pr-header-edit',
    module: 'procurement',
  });

  const { reset } = form;
  // Re-seed the form from the live props when the panel mounts (it is mounted only
  // while the header Edit action holds it open).
  useEffect(() => {
    reset({ title, projectId, vendorId });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once on mount from props
  }, []);

  const titleField = form.fieldProps('title');

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      try {
        await onSave({
          title: values.title.trim(),
          projectId: values.projectId,
          vendorId: values.vendorId,
        });
        onClose();
      } catch (err) {
        onError(err);
      }
    });
  };

  return (
    <Card className="mb-4" data-testid="header-edit-card">
      <CardHead>Edit request details</CardHead>
      <form onSubmit={handleSubmit}>
        <CardPad className="flex flex-col gap-4">
          <FormGrid>
            <TextField
              id={titleField.id}
              label="Title"
              required
              value={titleField.value}
              onChange={titleField.onChange}
              onBlur={titleField.onBlur}
              error={titleField.error}
              fullWidth
              placeholder="Request title"
            />
            <Combobox
              label="Project"
              noun="project"
              placeholder={projectName ?? 'Select a project…'}
              value={form.values.projectId}
              selectedOption={
                form.values.projectId && projectName
                  ? { value: form.values.projectId, label: projectName }
                  : undefined
              }
              onChange={(v) => form.setValue('projectId', v)}
              loadOptions={loadProjects}
            />
            <Combobox
              label="Vendor"
              noun="vendor"
              placeholder={vendorName ?? 'Optional — select a vendor…'}
              value={form.values.vendorId}
              selectedOption={
                form.values.vendorId && vendorName
                  ? { value: form.values.vendorId, label: vendorName }
                  : undefined
              }
              onChange={(v) => form.setValue('vendorId', v)}
              loadOptions={loadVendors}
            />
          </FormGrid>
          <FormActions
            submitLabel="Save request"
            onCancel={onClose}
            disabled={!form.canSubmit}
            loading={busy || form.isSubmitting}
          />
        </CardPad>
      </form>
    </Card>
  );
};

ProcurementHeaderEdit.displayName = 'ProcurementHeaderEdit';
