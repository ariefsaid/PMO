/**
 * LedgerFileCell — renders the File column cell for a single ledger row.
 *
 * Prop-driven. File presence (title, count, path) is pre-computed from the
 * detail bundle by buildLedgerRows — zero per-row network calls on mount.
 *
 * States:
 *   has file, single  → button showing the file title; click lazily signs the
 *                       URL via getSignedDownloadUrl and opens in a new tab.
 *                       On sign failure (e.g. seed rows with no storage object)
 *                       shows a toast-like inline error — never a console error.
 *   has file, multi   → button showing "N files"; click opens the full
 *                       ProcurementFilesSubsection (via onOpenFiles callback).
 *   no file, canWrite → compact "Attach" icon-button that triggers a hidden
 *                       file input, uploading to this record via useProcurementFiles.
 *   no file, read-only → "—" span.
 *
 * Compact by design (dense table cell). Reuses existing file helpers + sized Icon.
 * DESIGN.md tokens only; no raw hex/px. WCAG-AA: buttons have aria-label.
 */
import React, { useRef } from 'react';
import { Icon, useToast } from '@/src/components/ui';
import { procurementFileTarget } from '@/src/components/documents/targets/procurement';
import { useViewerOnDemand } from '@/src/components/documents/viewerContext';
import { useProcurementFiles } from '@/src/hooks/useProcurementFiles';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { FILE_INPUT_ACCEPT } from '@/src/lib/fileConstants';
import type { ProcPhase } from '@/src/lib/db/procurementFiles';
import type { LedgerFileRef, RecordType } from '@/src/lib/db/procurementLedger';

// ---------------------------------------------------------------------------
// RecordType → ProcPhase mapping
// ---------------------------------------------------------------------------

const PHASE_BY_TYPE: Record<RecordType, ProcPhase> = {
  PR: 'purchase_request',
  RFQ: 'rfq',
  Quote: 'quotation',
  PO: 'purchase_order',
  GR: 'receipt',
  Invoice: 'invoice',
  Payment: 'payment',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface LedgerFileCellProps {
  type: RecordType;
  recordId: string;
  systemNumber: string | null;
  /** Storage path of the first file (from buildLedgerRows bundle embed). Null = no file. */
  fileHref: string | null;
  /** Display title for the first file. Null when no file. */
  fileTitle: string | null;
  /** Count of non-archived files for this record (0 = none). */
  fileCount: number;
  /** The first file's row id and SharePoint reference (from the same bundle embed). */
  fileRef?: LedgerFileRef;
  /** Whether write affordances (upload) are shown. UX gate; RLS is authoritative. */
  canWrite: boolean;
  /** The owning procurement id (upload path + query invalidation). */
  procurementId: string;
  /** Current user id stamped onto new file rows. */
  uploadedById: string | null;
  /**
   * Called when the user wants to open the full files UI for this record
   * (e.g. when fileCount > 1). The parent mounts ProcurementFilesSubsection.
   */
  onOpenFiles?: () => void;
}

// ---------------------------------------------------------------------------
// Single-file view button (lazy sign on click)
// ---------------------------------------------------------------------------

interface SingleFileButtonProps {
  phase: ProcPhase;
  recordId: string;
  fileHref: string;
  fileTitle: string;
  fileRef?: LedgerFileRef;
  procurementId: string;
  uploadedById: string | null;
  label: string;
}

/** Opens the record's file in the side-panel viewer; the viewer signs the URL fresh and reports a failure itself. */
const SingleFileButton: React.FC<SingleFileButtonProps> = ({ phase, recordId, fileHref, fileTitle, fileRef, procurementId, uploadedById, label }) => {
  const viewer = useViewerOnDemand();
  const { download } = useProcurementFiles(phase, recordId, procurementId, uploadedById, { list: false });
  return (
    <button
      type="button"
      onClick={(e) => viewer.open(
        procurementFileTarget({
          phase,
          // The ledger bundle carries only the first file; a SharePoint row is addressed by its own row id.
          file: fileRef?.source === 'onedrive'
            ? { id: fileRef.id, title: fileTitle, file_path: null, source: 'onedrive', ms_web_url: fileRef.ms_web_url, ms_item_name: fileRef.ms_item_name }
            : { id: recordId, title: fileTitle, file_path: fileHref, source: null, ms_web_url: null, ms_item_name: null },
          getSignedUrl: download,
        }),
        e.currentTarget,
      )}
      aria-label={label}
      title={fileTitle}
      className="inline-flex items-center gap-1 text-[12.5px] font-medium text-primary-text hover:underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Icon name="file" className="size-3.5 shrink-0" />
      <span className="truncate max-w-[120px]">{fileTitle}</span>
    </button>
  );
};

// ---------------------------------------------------------------------------
// Compact upload button (no-file + canWrite)
// ---------------------------------------------------------------------------

interface AttachButtonProps {
  type: RecordType;
  recordId: string;
  procurementId: string;
  uploadedById: string | null;
}

const AttachButton: React.FC<AttachButtonProps> = ({
  type,
  recordId,
  procurementId,
  uploadedById,
}) => {
  const { toast } = useToast();
  const phase = PHASE_BY_TYPE[type];
  const inputRef = useRef<HTMLInputElement>(null);
  const { upload, uploadDisabled } = useProcurementFiles(phase, recordId, procurementId, uploadedById, {
    list: false,
  });

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
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

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={FILE_INPUT_ACCEPT}
        aria-label="Attach a file to this record"
        className="sr-only"
        onChange={onPick}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={upload.isPending || uploadDisabled}
        aria-label="Attach file"
        title="Attach file"
        className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-primary disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Icon name="upload" className="size-3.5 shrink-0" />
        {upload.isPending ? (
          <span>Uploading…</span>
        ) : (
          <span>Attach</span>
        )}
      </button>
    </>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const LedgerFileCell: React.FC<LedgerFileCellProps> = ({
  type,
  recordId,
  systemNumber,
  fileHref,
  fileTitle,
  fileCount,
  fileRef,
  canWrite,
  procurementId,
  uploadedById,
  onOpenFiles,
}) => {
  // Multiple files → show "N files" count button; clicks open the files panel if provided
  if (fileCount > 1) {
    return (
      <button
        type="button"
        onClick={onOpenFiles}
        aria-label={`${fileCount} files for ${systemNumber ?? type} — click to view all`}
        className="inline-flex items-center gap-1 text-[12.5px] font-medium text-primary-text hover:underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Icon name="file" className="size-3.5 shrink-0" />
        <span>{fileCount} files</span>
      </button>
    );
  }

  // Single file → lazy signed URL on click
  if (fileHref && fileTitle) {
    return (
      <SingleFileButton
        phase={PHASE_BY_TYPE[type]}
        recordId={recordId}
        fileHref={fileHref}
        fileTitle={fileTitle}
        fileRef={fileRef}
        procurementId={procurementId}
        uploadedById={uploadedById}
        label={`Open file for ${systemNumber ?? type}`}
      />
    );
  }

  // No file + writer → upload affordance
  if (canWrite) {
    return (
      <AttachButton
        type={type}
        recordId={recordId}
        procurementId={procurementId}
        uploadedById={uploadedById}
      />
    );
  }

  // No file + read-only → dash
  return <span className="text-[12px] text-muted-foreground">—</span>;
};

LedgerFileCell.displayName = 'LedgerFileCell';
