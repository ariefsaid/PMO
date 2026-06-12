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

  const clearProgress = (docId: string) => {
    setProgress((prev) => {
      const next = { ...prev };
      delete next[docId];
      return next;
    });
  };

  const clearError = (docId: string) => {
    setUploadErrors((prev) => {
      const next = { ...prev };
      delete next[docId];
      return next;
    });
  };

  const clearAbortRef = (docId: string) => {
    delete abortRefs.current[docId];
  };

  const uploadDocumentFile = async (docId: string, file: File, allowReplace: boolean) => {
    setProgress((prev) => ({ ...prev, [docId]: 0 }));
    clearError(docId);

    const controller = new AbortController();
    abortRefs.current[docId] = controller;

    try {
      const { signedUrl, path, oldPath } = await repositories.document.prepareUpload(docId, file.name);
      const ext = getExtension(file.name);
      const contentType = FILE_MIME_BY_EXT[ext] || file.type || 'application/octet-stream';
      await uploadWithProgress(signedUrl, file, {
        contentType,
        upsert: false,
        onProgress: (p) => setProgress((prev) => ({ ...prev, [docId]: p })),
        signal: controller.signal,
      });
      await repositories.document.confirmUpload(docId, path);
      if (allowReplace && oldPath) {
        repositories.document.cleanupObject(oldPath).catch(() => {});
      }
      return path;
    } finally {
      clearAbortRef(docId);
    }
  };

  const onError = (error: unknown, docId: string) => {
    const classified = classifyUploadError(error, MAX_FILE_SIZE_MB);
    if (classified.type !== 'cancel') {
      setUploadErrors((prev) => ({ ...prev, [docId]: classified }));
    }
    clearProgress(docId);
    clearAbortRef(docId);
  };

  const upload = useMutation({
    mutationFn: async ({ docId, file }: UploadArgs) => uploadDocumentFile(docId, file, true),
    onSuccess: () => {
      invalidate();
      setProgress({});
    },
    onError: (error, variables) => {
      onError(error, variables.docId);
    },
  });

  const replace = useMutation({
    mutationFn: async ({ docId, file }: ReplaceArgs) => uploadDocumentFile(docId, file, true),
    onSuccess: () => {
      invalidate();
      setProgress({});
    },
    onError: (error, variables) => {
      onError(error, variables.docId);
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