import React, { useCallback, useState } from 'react';
import {
  Card,
  CardHead,
  CardPad,
  Button,
  Icon,
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
// ProcurementHeaderEdit — the Draft-header edit affordance (crud-components §3
// inline detail-header edit, §9.3 "edit while Draft/Rejected"). An Edit button
// flips the request's editable header fields (title + project + vendor) into
// controls with Save/Cancel; gated by the caller (requester while Draft/Rejected).
// Inline rather than a giant modal-over-page (the modal-first anti-pattern).
//
// Backed by `useEntityForm` (matches NewProcurementModal): one controlled-form
// helper owns values / dirty / submit / per-field validation, so the title-required
// rule and the disabled-Save state are the shared form contract, not ad-hoc state.
// Token-pure (Card / Button / form primitives).
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
  busy,
}) => {
  const [editing, setEditing] = useState(false);

  const form = useEntityForm<FormValues>({
    initialValues: { title, projectId, vendorId },
    validate,
    idPrefix: 'pr-header-edit',
  });

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

  const start = () => {
    // Re-seed the form from the live props each time editing opens.
    form.reset({ title, projectId, vendorId });
    setEditing(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      try {
        await onSave({
          title: values.title.trim(),
          projectId: values.projectId,
          vendorId: values.vendorId,
        });
        setEditing(false);
      } catch (err) {
        onError(err);
      }
    });
  };

  if (!editing) {
    return (
      <Card className="mb-4" data-testid="header-edit-card">
        <CardPad className="flex items-center gap-3">
          <div className="min-w-0 flex-1 text-[13px] text-muted-foreground">
            This request is editable while it is a draft. Update the title, project, or vendor.
          </div>
          <Button size="sm" variant="outline" onClick={start} data-testid="edit-header">
            <Icon name="doc" />
            Edit request
          </Button>
        </CardPad>
      </Card>
    );
  }

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
            onCancel={() => setEditing(false)}
            disabled={!form.canSubmit}
            loading={busy || form.isSubmitting}
          />
        </CardPad>
      </form>
    </Card>
  );
};

ProcurementHeaderEdit.displayName = 'ProcurementHeaderEdit';
