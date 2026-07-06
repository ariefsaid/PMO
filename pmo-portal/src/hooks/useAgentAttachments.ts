import { useCallback, useState } from 'react';
import { repositories } from '@/src/lib/repositories';
import { uploadWithProgress, classifyUploadError } from '@/src/lib/uploadTransport';
import type { ClassifiedUploadError } from '@/src/lib/uploadTransport';
import { AGENT_ATTACHMENT_MAX_MB, getAgentAttachmentContentType } from '@/src/lib/agent/attachmentMime';
import { createAgentThread } from '@/src/lib/db/agentThreads';

export function useAgentAttachments(threadId: string | null) {
  const [preparedThreadId, setPreparedThreadId] = useState<string | null>(threadId);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [error, setError] = useState<ClassifiedUploadError | null>(null);

  const clearProgress = useCallback((attachmentId: string) => {
    setProgress((prev) => {
      const next = { ...prev };
      delete next[attachmentId];
      return next;
    });
  }, []);

  const uploadAttachment = useCallback(
    async (file: File): Promise<string> => {
      const activeThreadId = preparedThreadId ?? (await createAgentThread()).id;
      if (!preparedThreadId) setPreparedThreadId(activeThreadId);

      setError(null);
      const prepared = await repositories.agentAttachment.prepareUpload(activeThreadId, file);
      setProgress((prev) => ({ ...prev, [prepared.attachmentId]: 0 }));

      try {
        await uploadWithProgress(prepared.signedUrl, file, {
          contentType: getAgentAttachmentContentType(file) ?? (file.type || 'application/octet-stream'),
          upsert: false,
          onProgress: (pct) =>
            setProgress((prev) => ({ ...prev, [prepared.attachmentId]: pct })),
        });
        await repositories.agentAttachment.confirmUpload(prepared.attachmentId);
        clearProgress(prepared.attachmentId);
        return prepared.attachmentId;
      } catch (uploadError) {
        repositories.agentAttachment.cleanupObject(prepared.path).catch(() => {});
        clearProgress(prepared.attachmentId);
        const classified = classifyUploadError(uploadError, AGENT_ATTACHMENT_MAX_MB);
        if (classified.type !== 'cancel') setError(classified);
        throw uploadError;
      }
    },
    [clearProgress, preparedThreadId],
  );

  const clearError = useCallback(() => setError(null), []);
  const reportError = useCallback((nextError: ClassifiedUploadError) => setError(nextError), []);

  return { uploadAttachment, progress, error, clearError, reportError, threadId: preparedThreadId };
}
