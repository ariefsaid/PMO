import { useState, useCallback, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { uploadWithProgress, classifyUploadError } from '@/src/lib/uploadTransport';
import { FILE_MIME_BY_EXT, MAX_FILE_SIZE_MB } from '@/src/lib/fileConstants';
import type { ClassifiedUploadError } from '@/src/lib/uploadTransport';
import type { ProcPhase, ProcurementFileRow } from '@/src/lib/db/procurementFiles';

/**
 * Per-phase procurement-file list + upload/archive/download mutations (ADR-0023).
 *
 * Parallel to `useFileUpload` (the project-documents hook) but bound to a single phase row
 * (quotation/receipt/invoice) and the `procurement-files` bucket — kept separate so the two
 * streams stay isolated (no behavior change to the documents register). The DAL stamps
 * org_id via the column default + RLS; the client never sends it. `uploadedById` = the
 * current user id, passed by the caller (the file row records who uploaded it).
 */

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot >= 0 ? filename.slice(lastDot).toLowerCase() : '';
}

export interface ProcFileUploadArgs {
  file: File;
  /** Optional human title for the file row (defaults to null → filename is the display). */
  title?: string | null;
}

export function useProcurementFiles(
  phase: ProcPhase,
  parentId: string,
  procurementId: string,
  orgId: string,
  uploadedById: string | null,
) {
  const qc = useQueryClient();
  const queryKey = ['procurement-files', phase, parentId] as const;
  const invalidate = () => qc.invalidateQueries({ queryKey });

  // A single in-flight upload per phase row (one file picker at a time).
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<ClassifiedUploadError | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const list = useQuery<ProcurementFileRow[]>({
    queryKey,
    queryFn: () => repositories.procurementFiles.list(phase, parentId),
  });

  const runUpload = async ({ file, title }: ProcFileUploadArgs): Promise<ProcurementFileRow> => {
    setProgress(0);
    setUploadError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { signedUrl, path } = await repositories.procurementFiles.prepareUpload(
        phase,
        parentId,
        procurementId,
        orgId,
        file.name,
      );
      const ext = getExtension(file.name);
      const contentType = FILE_MIME_BY_EXT[ext] || file.type || 'application/octet-stream';
      await uploadWithProgress(signedUrl, file, {
        contentType,
        upsert: false,
        onProgress: (p) => setProgress(p),
        signal: controller.signal,
      });
      const row = await repositories.procurementFiles.confirmUpload(
        phase,
        parentId,
        path,
        title ?? null,
        uploadedById,
      );
      // Best-effort: an orphan storage object on a failed confirm is acceptable; here confirm
      // succeeded so nothing to clean up.
      return row;
    } finally {
      abortRef.current = null;
    }
  };

  const upload = useMutation({
    mutationFn: runUpload,
    onSuccess: () => {
      setProgress(null);
      invalidate();
    },
    onError: (error: unknown) => {
      const classified = classifyUploadError(error, MAX_FILE_SIZE_MB);
      if (classified.type !== 'cancel') setUploadError(classified);
      setProgress(null);
      abortRef.current = null;
    },
  });

  const archive = useMutation({
    mutationFn: (id: string) => repositories.procurementFiles.archive(phase, id),
    onSuccess: () => invalidate(),
  });

  const download = useCallback(
    (filePath: string, opts?: { download?: boolean }) =>
      repositories.procurementFiles.getSignedUrl(filePath, opts),
    [],
  );

  const cancelUpload = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const clearUploadError = useCallback(() => setUploadError(null), []);

  return { list, upload, archive, download, progress, uploadError, cancelUpload, clearUploadError };
}
