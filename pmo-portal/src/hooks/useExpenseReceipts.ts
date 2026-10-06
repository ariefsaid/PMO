import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import { uploadWithProgress, classifyUploadError, type ClassifiedUploadError } from '@/src/lib/uploadTransport';
import { FILE_MIME_BY_EXT, MAX_FILE_SIZE_MB } from '@/src/lib/fileConstants';
import { receiptExtension } from '@/src/lib/db/expenseReceipts';

/** Receipts on one claim (#775) — the useProcurementFiles shape, bound to the `expense-receipts` bucket. */
export function useExpenseReceipts(claimId: string) {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  const queryKey = ['expense-receipts', orgId, claimId] as const;
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<ClassifiedUploadError | null>(null);

  const list = useQuery({
    queryKey,
    queryFn: () => repositories.expenseReceipts.list(claimId),
    enabled: Boolean(orgId) && Boolean(claimId),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      setProgress(0);
      setUploadError(null);
      const { signedUrl, path } = await repositories.expenseReceipts.prepareUpload(claimId, file.name);
      const contentType = FILE_MIME_BY_EXT[receiptExtension(file.name)] || file.type || 'application/octet-stream';
      await uploadWithProgress(signedUrl, file, { contentType, upsert: false, onProgress: (p) => setProgress(p) });
      try {
        return await repositories.expenseReceipts.confirmUpload(claimId, path, null);
      } catch (err) {
        // The object is in the bucket but its row was refused — remove the orphan, best effort (#78 pattern).
        repositories.expenseReceipts.cleanupObject(path).catch(() => {});
        throw err;
      }
    },
    onSuccess: () => {
      setProgress(null);
      void qc.invalidateQueries({ queryKey });
    },
    onError: (error: unknown) => {
      const classified = classifyUploadError(error, MAX_FILE_SIZE_MB);
      if (classified.type !== 'cancel') setUploadError(classified);
      setProgress(null);
    },
  });

  const archive = useMutation({
    mutationFn: (id: string) => repositories.expenseReceipts.archive(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey }),
  });

  const download = useCallback(
    (path: string, opts?: { download?: boolean }) => repositories.expenseReceipts.getSignedUrl(path, opts),
    [],
  );
  const clearUploadError = useCallback(() => setUploadError(null), []);

  return { list, upload, archive, download, progress, uploadError, clearUploadError };
}
