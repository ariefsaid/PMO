import { useCallback, useRef, useState } from 'react';
import { repositories } from '@/src/lib/repositories';
import { uploadWithProgress, classifyUploadError } from '@/src/lib/uploadTransport';
import type { ClassifiedUploadError } from '@/src/lib/uploadTransport';
import { AGENT_ATTACHMENT_MAX_MB, getAgentAttachmentContentType } from '@/src/lib/agent/attachmentMime';

export function useAgentAttachments(threadId: string | null) {
  const [preparedThreadId, setPreparedThreadId] = useState<string | null>(threadId);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [error, setError] = useState<ClassifiedUploadError | null>(null);

  const [inFlight, setInFlight] = useState(0);
  // Refs, not state: concurrent uploads in the same tick must see one shared thread, and a
  // conversation reset must retire uploads still in flight (generation token).
  const threadRef = useRef<string | null>(threadId);
  const creatingRef = useRef<Promise<string> | null>(null);
  const generationRef = useRef(0);

  const ensureThread = useCallback((): Promise<string> => {
    if (threadRef.current) return Promise.resolve(threadRef.current);
    if (!creatingRef.current) {
      const gen = generationRef.current;
      const creating = repositories.agentAttachment
        .createThread()
        .then((t) => {
          if (gen === generationRef.current) {
            threadRef.current = t.id;
            setPreparedThreadId(t.id);
          }
          return t.id;
        })
        .finally(() => {
          if (creatingRef.current === creating) creatingRef.current = null;
        });
      creatingRef.current = creating;
    }
    return creatingRef.current;
  }, []);

  const clearProgress = useCallback((attachmentId: string) => {
    setProgress((prev) => {
      const next = { ...prev };
      delete next[attachmentId];
      return next;
    });
  }, []);

  const uploadAttachment = useCallback(
    async (file: File): Promise<string> => {
      const gen = generationRef.current;
      const retired = () => gen !== generationRef.current;
      const resetAbort = () => new DOMException('Conversation was reset', 'AbortError');
      setInFlight((n) => n + 1);
      try {
        // MINOR-7 (review, ADR-0017): thread creation routes through the repository seam.
        const activeThreadId = await ensureThread();
        if (retired()) throw resetAbort();

        setError(null);
        const prepared = await repositories.agentAttachment.prepareUpload(activeThreadId, file);
        if (retired()) {
          repositories.agentAttachment.cleanupObject(prepared.path).catch(() => {});
          throw resetAbort();
        }
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
        } catch (uploadError) {
          repositories.agentAttachment.cleanupObject(prepared.path).catch(() => {});
          clearProgress(prepared.attachmentId);
          const classified = classifyUploadError(uploadError, AGENT_ATTACHMENT_MAX_MB);
          if (classified.type !== 'cancel' && !retired()) setError(classified);
          throw uploadError;
        }
        // Finished after a New conversation: the attachment belongs to the retired thread.
        if (retired()) throw resetAbort();
        return prepared.attachmentId;
      } finally {
        setInFlight((n) => n - 1);
      }
    },
    [clearProgress, ensureThread],
  );

  const clearError = useCallback(() => setError(null), []);
  const reportError = useCallback((nextError: ClassifiedUploadError) => setError(nextError), []);

  // CRITICAL-1 (review): a New Conversation must NOT inherit the previous conversation's
  // prepared thread — otherwise an attachment uploaded after "New conversation" binds to
  // the stale thread and leaks across conversations. resetThread() returns preparedThreadId
  // to the threadId prop (null when the panel passes no existing thread).
  const resetThread = useCallback(() => {
    generationRef.current += 1;
    creatingRef.current = null;
    threadRef.current = threadId;
    setPreparedThreadId(threadId);
  }, [threadId]);

  return {
    uploadAttachment,
    progress,
    isUploading: inFlight > 0,
    error,
    clearError,
    reportError,
    threadId: preparedThreadId,
    resetThread,
  };
}
