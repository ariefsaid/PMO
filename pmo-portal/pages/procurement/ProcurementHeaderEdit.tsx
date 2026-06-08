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
  type ComboboxOption,
} from '@/src/components/ui';
import { repositories } from '@/src/lib/repositories';
import type { ProcurementHeaderPatch } from '@/src/lib/db/procurementCrud';

// ---------------------------------------------------------------------------
// ProcurementHeaderEdit — the Draft-header edit affordance (crud-components §3
// inline detail-header edit, §9.3 "edit while Draft/Rejected"). An Edit button
// flips the request's editable header fields (title + project + vendor) into
// controls with Save/Cancel; gated by the caller (requester while Draft/Rejected).
// Inline rather than a giant modal-over-page (the modal-first anti-pattern).
// Token-pure (Card / Button / form primitives).
// ---------------------------------------------------------------------------

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
  const [titleVal, setTitleVal] = useState(title);
  const [projVal, setProjVal] = useState<string | null>(projectId);
  const [vendVal, setVendVal] = useState<string | null>(vendorId);

  const loadProjects = useCallback(async (): Promise<ComboboxOption[]> => {
    const rows = await repositories.project.list();
    return rows.map((p) => ({ value: p.id, label: p.name, sub: p.code ?? undefined }));
  }, []);
  const loadVendors = useCallback(async (): Promise<ComboboxOption[]> => {
    const rows = await repositories.company.list({ type: 'Vendor' });
    return rows.map((c) => ({ value: c.id, label: c.name, sub: 'Vendor' }));
  }, []);

  const start = () => {
    setTitleVal(title);
    setProjVal(projectId);
    setVendVal(vendorId);
    setEditing(true);
  };

  const save = async () => {
    if (!titleVal.trim()) return;
    try {
      await onSave({ title: titleVal.trim(), projectId: projVal, vendorId: vendVal });
      setEditing(false);
    } catch (err) {
      onError(err);
    }
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
      <CardPad className="flex flex-col gap-4">
        <FormGrid>
          <TextField
            label="Title"
            required
            value={titleVal}
            onChange={setTitleVal}
            fullWidth
            placeholder="Request title"
          />
          <Combobox
            label="Project"
            noun="project"
            placeholder={projectName ?? 'Select a project…'}
            value={projVal}
            selectedOption={
              projVal && projectName ? { value: projVal, label: projectName } : undefined
            }
            onChange={(v) => setProjVal(v)}
            loadOptions={loadProjects}
          />
          <Combobox
            label="Vendor"
            noun="vendor"
            placeholder={vendorName ?? 'Optional — select a vendor…'}
            value={vendVal}
            selectedOption={
              vendVal && vendorName ? { value: vendVal, label: vendorName } : undefined
            }
            onChange={(v) => setVendVal(v)}
            loadOptions={loadVendors}
          />
        </FormGrid>
        <FormActions
          submitLabel="Save request"
          onCancel={() => setEditing(false)}
          onSubmit={() => void save()}
          disabled={!titleVal.trim()}
          loading={busy}
        />
      </CardPad>
    </Card>
  );
};

ProcurementHeaderEdit.displayName = 'ProcurementHeaderEdit';
