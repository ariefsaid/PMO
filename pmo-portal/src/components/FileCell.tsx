import React from 'react';
import { Icon } from '@/src/components/ui/icons';
import { PREVIEWABLE_EXTENSIONS } from '@/src/lib/fileConstants';

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function getExtension(path: string): string {
  const lastDot = path.lastIndexOf('.');
  return lastDot >= 0 ? path.slice(lastDot).toLowerCase() : '';
}

function isPreviewable(path: string): boolean {
  return (PREVIEWABLE_EXTENSIONS as readonly string[]).includes(getExtension(path));
}

function extractFilename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

export interface FileCellProps {
  status: string;
  filePath: string | null;
  title: string;
  uploadProgress?: number | null;
  uploadError?: string | null;
  onUpload?: () => void;
  onReplace?: () => void;
  onCancelUpload?: () => void;
  onRemoveError?: () => void;
  onDownload?: () => void;
  onPreview?: () => void;
}

/**
 * FileCell — renders the File column in the DocumentsTab register.
 *
 * States per FR-DOC-080:
 *   Draft, no file         → Upload link
 *   Draft, has file        → filename + Replace link
 *   Draft, uploading       → progress bar + cancel
 *   Draft, error           → error message + Remove
 *   Issued/Approved/Closed/Superseded, has file → filename + download + (preview if previewable)
 *   Rejected, no file      → em-dash (read-only)
 *   Non-Draft, no file     → em-dash
 */
export const FileCell: React.FC<FileCellProps> = ({
  status,
  filePath,
  title,
  uploadProgress,
  uploadError,
  onUpload,
  onReplace,
  onCancelUpload,
  onRemoveError,
  onDownload,
  onPreview,
}) => {
  // ── Uploading state (progress bar + cancel)
  if (uploadProgress != null) {
    return (
      <span className="flex items-center gap-1.5 min-w-0">
        <span
          role="progressbar"
          aria-label={`Upload progress for ${title}`}
          aria-valuenow={uploadProgress}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1 flex-1 min-w-[48px] overflow-hidden rounded-xs bg-secondary"
        >
          <span
            className="block h-full rounded-xs bg-primary"
            style={{ width: `${uploadProgress}%` }}
          />
        </span>
        <span className="text-[12px] text-muted-foreground tabular">{uploadProgress}%</span>
        {onCancelUpload && (
          <button
            type="button"
            onClick={onCancelUpload}
            aria-label={`Cancel upload for ${title}`}
            className="touch-target text-muted-foreground hover:text-foreground p-1 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Icon name="x" className="size-3.5" />
          </button>
        )}
      </span>
    );
  }

  // ── Error state
  if (uploadError) {
    return (
      <span className="flex items-center gap-1.5 min-w-0">
        <span role="alert" className="text-[12px] text-destructive truncate">{uploadError}</span>
        {onRemoveError && (
          <button
            type="button"
            onClick={onRemoveError}
            aria-label={`Remove failed upload for ${title}`}
            className="touch-target text-[12px] text-muted-foreground hover:text-foreground underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Remove
          </button>
        )}
      </span>
    );
  }

  const isDraft = status === 'Draft';

  // ── Draft, no file → Upload link
  if (isDraft && !filePath) {
    return onUpload ? (
      <button
        type="button"
        onClick={onUpload}
        aria-label={`Upload file for ${title}`}
        className="touch-target inline-flex items-center gap-1 text-[12px] text-foreground hover:text-primary-text font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Icon name="upload" className="size-3.5" />
        Upload
      </button>
    ) : <span className="text-muted-foreground">—</span>;
  }

  // ── Draft, has file → filename + Replace
  if (isDraft && filePath) {
    const name = extractFilename(filePath);
    return (
      <span className="flex items-center gap-1.5 min-w-0">
        <Icon name="file" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-[13px]" title={name}>{truncate(name, 20)}</span>
        {onReplace && (
          <button
            type="button"
            onClick={onReplace}
            aria-label={`Replace file for ${title}`}
            className="touch-target text-[12px] text-primary-text hover:underline font-medium shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Replace
          </button>
        )}
      </span>
    );
  }

  // ── Non-Draft, has file → filename + download + (optional) preview
  if (!isDraft && filePath) {
    const name = extractFilename(filePath);
    const canPreview = isPreviewable(filePath);
    return (
      <span className="flex items-center gap-1.5 min-w-0">
        <Icon name="file" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-[13px]" title={name}>{truncate(name, 20)}</span>
        {onDownload && (
          <button
            type="button"
            onClick={onDownload}
            aria-label={`Download file for ${title}`}
            className="touch-target text-muted-foreground hover:text-primary-text p-0.5 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            title="Download file"
          >
            <Icon name="download" className="size-4" />
          </button>
        )}
        {canPreview && onPreview && (
          <button
            type="button"
            onClick={onPreview}
            aria-label={`Preview file for ${title}`}
            className="touch-target text-muted-foreground hover:text-primary-text p-0.5 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            title="Preview file"
          >
            <Icon name="eye" className="size-4" />
          </button>
        )}
      </span>
    );
  }

  // ── Non-Draft, no file → em-dash
  return <span className="text-muted-foreground">—</span>;
};
