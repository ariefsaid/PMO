import React, { useState } from 'react';
import {
  Card,
  CardHead,
  CardPad,
  Button,
  Icon,
  StatusPill,
  TextField,
  SelectField,
  ListState,
  ConfirmDialog,
} from '@/src/components/ui';
import type {
  ProcurementDocumentRow,
  ProcurementDocStatus,
  ProcurementDocumentInput,
} from '@/src/lib/db/procurementCrud';
import { workflowVariant } from '@/src/lib/status/statusVariants';

// ---------------------------------------------------------------------------
// ProcurementDocumentsSection — the document-metadata register over the
// (previously dead) procurement_documents table (crud-components §9.6). Metadata
// list + add (type, reference, status) + remove. File upload is DEFERRED
// (Storage off): a visibly-disabled "Attach file" affordance, never a broken
// control. Add/remove gated by the caller; read-only renders a clean list.
// Token-pure (Card / Button / StatusPill / form primitives / ConfirmDialog).
// ---------------------------------------------------------------------------

const DOC_STATUS_OPTIONS: { value: ProcurementDocStatus; label: string }[] = [
  { value: 'Draft', label: 'Draft' },
  { value: 'Issued', label: 'Issued' },
  { value: 'Approved', label: 'Approved' },
  { value: 'Rejected', label: 'Rejected' },
  { value: 'Closed', label: 'Closed' },
];

// Doc-status pill comes from the single status registry (`workflowVariant`):
// Issued = neutral grey `progress` (NOT the action-blue, per the Freed-Blue Status
// Rule); Approved = green; Rejected = red; Draft/Closed/Superseded = grey neutrals.

export interface ProcurementDocumentsSectionProps {
  documents: ProcurementDocumentRow[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  /** Add/remove affordances shown (Admin·Exec·PM·Finance). */
  editable: boolean;
  onAdd: (input: ProcurementDocumentInput) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  onError: (err: unknown) => void;
  addBusy?: boolean;
  deleteBusy?: boolean;
}

export const ProcurementDocumentsSection: React.FC<ProcurementDocumentsSectionProps> = ({
  documents,
  loading,
  error,
  onRetry,
  editable,
  onAdd,
  onDelete,
  onError,
  addBusy,
  deleteBusy,
}) => {
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState('');
  const [reference, setReference] = useState('');
  const [status, setStatus] = useState<ProcurementDocStatus>('Draft');
  const [deleteTarget, setDeleteTarget] = useState<ProcurementDocumentRow | null>(null);

  const resetAdd = () => {
    setAdding(false);
    setType('');
    setReference('');
    setStatus('Draft');
  };

  const submitAdd = async () => {
    if (!type.trim()) return;
    try {
      await onAdd({ type: type.trim(), referenceNumber: reference.trim() || null, status });
      resetAdd();
    } catch (err) {
      onError(err);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      await onDelete(target.id);
      setDeleteTarget(null);
    } catch (err) {
      onError(err);
      setDeleteTarget(null);
    }
  };

  return (
    <Card className="mt-4" data-testid="documents-section">
      <CardHead>
        Documents
        <span className="flex-1" />
        {editable && !adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)} data-testid="add-document">
            <Icon name="plus" />
            Add document
          </Button>
        )}
      </CardHead>

      {loading ? (
        <ListState variant="loading" rows={2} />
      ) : error ? (
        <ListState
          variant="error"
          title="Couldn't load documents"
          sub="The request failed. Try again."
          onRetry={onRetry}
        />
      ) : (
        <CardPad className="flex flex-col gap-px">
          {documents.length === 0 ? (
            <p className="py-2 text-[13px] text-muted-foreground">
              No documents on this request yet.
            </p>
          ) : (
            documents.map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-2.5 border-b border-dashed border-border py-2.5 last:border-b-0"
              >
                <Icon name="doc" className="size-[15px] shrink-0 text-muted-foreground" />
                <span className="font-medium">{d.type}</span>
                {d.reference_number && (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {d.reference_number}
                  </span>
                )}
                <span className="ml-auto flex items-center gap-2.5">
                  <StatusPill variant={workflowVariant(d.status)}>{d.status}</StatusPill>
                  {editable && (
                    <Button
                      size="sm"
                      variant="ghost"
                      iconOnly
                      aria-label={`Remove ${d.type}`}
                      onClick={() => setDeleteTarget(d)}
                    >
                      <Icon name="x" />
                    </Button>
                  )}
                </span>
              </div>
            ))
          )}

          {/* Inline-add document entry (metadata only; files deferred) */}
          {adding && (
            <div
              className="mt-3 flex flex-wrap items-end gap-3 rounded-md border border-border bg-secondary/35 p-3"
              data-testid="add-document-form"
            >
              <div className="min-w-[180px] flex-1">
                <TextField
                  label="Type"
                  required
                  value={type}
                  onChange={setType}
                  placeholder="e.g. Spec sheet, Datasheet"
                />
              </div>
              <div className="w-[160px]">
                <TextField
                  label="Reference"
                  value={reference}
                  onChange={setReference}
                  placeholder="optional"
                  mono
                />
              </div>
              <div className="w-[140px]">
                <SelectField
                  label="Status"
                  value={status}
                  onChange={(v) => setStatus(v as ProcurementDocStatus)}
                  options={DOC_STATUS_OPTIONS}
                />
              </div>
              <span
                title="File upload coming soon"
                className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-md border border-dashed border-input bg-secondary/50 px-2.5 text-[12.5px] text-muted-foreground"
              >
                <Icon name="doc" className="size-[14px]" />
                Attach file (coming soon)
              </span>
              <span className="flex-1" />
              <Button size="sm" variant="ghost" onClick={resetAdd}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={!type.trim()}
                loading={addBusy}
                onClick={() => void submitAdd()}
              >
                Add document
              </Button>
            </div>
          )}
        </CardPad>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        tone="destructive"
        title={deleteTarget ? `Remove ${deleteTarget.type}?` : 'Remove document?'}
        description="This removes the document record from the request. It does not delete any uploaded file (file upload is not yet enabled)."
        confirmLabel="Remove document"
        loading={deleteBusy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </Card>
  );
};

ProcurementDocumentsSection.displayName = 'ProcurementDocumentsSection';
