import { useState, useCallback, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { uploadWithProgress, classifyUploadError } from '@/src/lib/uploadTransport';
import { FILE_MIME_BY_EXT, MAX_FILE_SIZE_MB } from '@/src/lib/fileConstants';
import type { ClassifiedUploadError } from '@/src/lib/uploadTransport';

/**
 * File upload/replace mutations for the project-documents register.
 * The DAL takes (docId, fileName) only — org_id/project_id are fetched internally.
 * Real progress via XHR; real cancel via AbortSignal.
 */

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot >= 0 ? filename.slice(lastDot).toLowerCase() : '';
}

export interface UploadArgs {
  docId: string;
  file: File;
}

export type ReplaceArgs = UploadArgs;

export function useFileUpload(projectId: string) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['project-documents', projectId] });

  // Per-doc progress state
  const [progress, setProgress] = useState<Record<string, number>>({});
  // Per-doc error state (classified)
  const [uploadErrors, setUploadErrors] = useState<Record<string, ClassifiedUploadError>>({});
  // Per-doc AbortControllers
  const abortRefs = useRef<Record<string, AbortController>>({});

  const upload = useMutation({
    mutationFn: async ({ docId, file }: UploadArgs) => {
      // Clear prior state
      setProgress((prev) => ({ ...prev, [docId]: 0 }));
      setUploadErrors((prev) => { const next = { ...prev }; delete next[docId]; return next; });

      // Create AbortController for this upload
      const controller = new AbortController();
      abortRefs.current[docId] = controller;

      // Step 1: DAL prepares signed upload URL (fetches row internally)
      const { signedUrl, path, oldPath } = await repositories.document.prepareUpload(docId, file.name);

      // Step 2: Upload via XHR (real progress + abort)
      const ext = getExtension(file.name);
      const contentType = FILE_MIME_BY_EXT[ext] || file.type || 'application/octet-stream';
      await uploadWithProgress(signedUrl, file, {
        contentType,
        onProgress: (p) => setProgress((prev) => ({ ...prev, [docId]: p })),
        signal: controller.signal,
      });

      // Step 3: Confirm — update file_path on the row
      await repositories.document.confirmUpload(docId, path);

      // Cleanup prior object if replacing (non-fatal)
      // NOTE: oldPath is only non-null when replacing
      if (oldPath) {
        repositories.document.cleanupObject(oldPath).catch(() => {});
      }

      return path;
    },
    onSuccess: () => {
      invalidate();
      setProgress({});
    },
    onError: (error, variables) => {
      const classified = classifyUploadError(error, MAX_FILE_SIZE_MB);
      if (classified.type !== 'cancel') {
        setUploadErrors((prev) => ({ ...prev, [variables.docId]: classified }));
      }
      setProgress((prev) => { const next = { ...prev }; delete next[variables.docId]; return next; });
    },
  });

  const replace = useMutation({
    mutationFn: async ({ docId, file }: ReplaceArgs) => {
      setProgress((prev) => ({ ...prev, [docId]: 0 }));
      setUploadErrors((prev) => { const next = { ...prev }; delete next[docId]; return next; });

      const controller = new AbortController();
      abortRefs.current[docId] = controller;

      // DAL prepares (returns oldPath from the fetched row)
      const { signedUrl, path, oldPath } = await repositories.document.prepareUpload(docId, file.name);

      // Upload new file first (replace-flow atomicity: upload → confirm → delete old)
      const ext = getExtension(file.name);
      const contentType = FILE_MIME_BY_EXT[ext] || file.type || 'application/octet-stream';
      await uploadWithProgress(signedUrl, file, {
        contentType,
        upsert: false,
        onProgress: (p) => setProgress((prev) => ({ ...prev, [docId]: p })),
        signal: controller.signal,
      });

      // Confirm new file path BEFORE deleting old (atomicity: old stays intact if this fails)
      await repositories.document.confirmUpload(docId, path);

      // Delete old object (non-fatal — orphan is acceptable)
      if (oldPath) {
        repositories.document.cleanupObject(oldPath).catch(() => {});
      }

      return path;
    },
    onSuccess: () => {
      invalidate();
      setProgress({});
    },
    onError: (error, variables) => {
      const classified = classifyUploadError(error, MAX_FILE_SIZE_MB);
      if (classified.type !== 'cancel') {
        setUploadErrors((prev) => ({ ...prev, [variables.docId]: classified }));
      }
      setProgress((prev) => { const next = { ...prev }; delete next[variables.docId]; return next; });
    },
  });

  const cancelUpload = useCallback((docId: string) => {
    abortRefs.current[docId]?.abort();
    delete abortRefs.current[docId];
  }, []);

  const clearUploadError = useCallback((docId: string) => {
    setUploadErrors((prev) => { const next = { ...prev }; delete next[docId]; return next; });
  }, []);

  return { upload, replace, progress, uploadErrors, cancelUpload, clearUploadError };
}