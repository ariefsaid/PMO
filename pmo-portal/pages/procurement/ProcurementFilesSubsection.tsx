import React, { useRef, useState } from 'react';
import { Icon, ConfirmDialog, useToast } from '@/src/components/ui';
import { useProcurementFiles } from '@/src/hooks/useProcurementFiles';
import { FILE_INPUT_ACCEPT, PREVIEWABLE_EXTENSIONS } from '@/src/lib/fileConstants';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { ProcPhase, ProcurementFileRow } from '@/src/lib/db/procurementFiles';

// ---------------------------------------------------------------------------
// ProcurementFilesSubsection — many files per procurement PHASE row (ADR-0023).
// A compact attachment list under a quotation / GR / VI row: writers upload + soft-archive
// (ConfirmDialog), everyone reads/downloads (signed URL). Token-pure (DESIGN.md), no raw
// hex/px. RLS (migration 0028) is the enforcement authority; `canWrite` is UX-only.
// ---------------------------------------------------------------------------

export interface ProcurementFilesSubsectionProps {
  phase: ProcPhase;
  /** The phase parent id (quotation_id / receipt_id / invoice_id). */
  parentId: string;
  /** The owning procurement id — path segment 2 + the storage-RLS in-org check. */
  procurementId: string;
  /** The caller's org id — path segment 1 (RLS re-verifies it). */
  orgId: string;
  /** Whether write affordances (upload/archive) are shown. UX gate; RLS is authoritative. */
  canWrite: boolean;
  /** Current user id stamped onto new file rows (who uploaded). */
  uploadedById: string | null;
}

function filename(path: string | null): string {
  if (!path) return 'file';
  const parts = path.split('/');
  return parts[parts.length - 1] || 'file';
}

function getExtension(path: string): string {
  const lastDot = path.lastIndexOf('.');
  return lastDot >= 0 ? path.slice(lastDot).toLowerCase() : '';
}

function isPreviewable(path: string | null): boolean {
  return path != null && (PREVIEWABLE_EXTENSIONS as readonly string[]).includes(getExtension(path));
}

export const ProcurementFilesSubsection: React.FC<ProcurementFilesSubsectionProps> = ({
  phase,
  parentId,
  procurementId,
  orgId,
  canWrite,
  uploadedById,
}) => {
  const { toast } = useToast();
  const { list, upload, archive, download, progress, uploadError, clearUploadError } =
    useProcurementFiles(phase, parentId, procurementId, orgId, uploadedById);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingArchive, setPendingArchive] = useState<ProcurementFileRow | null>(null);

  const files = list.data ?? [];
  const uploading = progress != null;

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    clearUploadError();
    upload.mutate(
      { file },
      {
        onSuccess: () => toast('File attached', file.name, 'success'),
        onError: (err: unknown) => {
          const { headline, detail } = classifyMutationError(err);
          toast(headline, detail, 'warning');
        },
      },
    );
  };

  const openFile = async (file: ProcurementFileRow, asDownload: boolean) => {
    if (!file.file_path) return;
    try {
      const url = await download(file.file_path, { download: asDownload });
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  const confirmArchive = () => {
    if (!pendingArchive) return;
    const target = pendingArchive;
    setPendingArchive(null);
    archive.mutate(target.id, {
      onSuccess: () => toast('File removed', undefined, 'success'),
      onError: (err: unknown) => {
        const { headline, detail } = classifyMutationError(err);
        toast(headline, detail, 'warning');
      },
    });
  };

  return (
    <div className="mt-2 flex flex-col gap-1.5 border-t border-dashed border-border/60 pt-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
          Attachments
        </span>
        <span className="flex-1" />
        {canWrite && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept={FILE_INPUT_ACCEPT}
              aria-label="Attach a file"
              className="sr-only"
              onChange={onPick}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading || upload.isPending}
              className="touch-target inline-flex items-center gap-1 rounded-sm text-[12px] font-medium text-primary hover:underline disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Icon name="upload" className="size-3.5" />
              {uploading ? `Uploading ${progress}%` : 'Attach file'}
            </button>
          </>
        )}
      </div>

      {list.isPending ? (
        <p className="text-[12px] text-muted-foreground">Loading attachments…</p>
      ) : list.isError ? (
        <p role="alert" className="text-[12px] text-destructive">
          Couldn&apos;t load attachments.
        </p>
      ) : files.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">No files attached.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {files.map((f) => {
            const name = filename(f.file_path);
            return (
              <li key={f.id} className="flex items-center gap-2 text-[13px]">
                <Icon name="file" className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate" title={name}>
                  {name}
                </span>
                <span className="ml-auto flex items-center gap-1.5">
                  {f.file_path && isPreviewable(f.file_path) && (
                    <button
                      type="button"
                      onClick={() => void openFile(f, false)}
                      aria-label={`Preview file ${name}`}
                      title="Preview"
                      className="touch-target rounded-sm p-0.5 text-muted-foreground hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <Icon name="eye" className="size-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void openFile(f, true)}
                    aria-label={`Download file ${name}`}
                    title="Download"
                    className="touch-target rounded-sm p-0.5 text-muted-foreground hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <Icon name="download" className="size-4" />
                  </button>
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => setPendingArchive(f)}
                      aria-label={`Remove file ${name}`}
                      title="Remove"
                      className="touch-target rounded-sm p-0.5 text-muted-foreground hover:text-destructive focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <Icon name="x" className="size-3.5" />
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {uploadError && (
        <p role="alert" className="text-[12px] text-destructive">
          {uploadError.message}
        </p>
      )}

      <ConfirmDialog
        open={pendingArchive !== null}
        tone="destructive"
        title="Remove this attachment?"
        description={
          pendingArchive
            ? `This removes "${filename(pendingArchive.file_path)}" from this record. It can be re-uploaded if needed.`
            : ''
        }
        confirmLabel="Remove"
        loading={archive.isPending}
        onConfirm={confirmArchive}
        onCancel={() => setPendingArchive(null)}
      />
    </div>
  );
};

ProcurementFilesSubsection.displayName = 'ProcurementFilesSubsection';
