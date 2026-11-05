import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseRemoteStringDraftOptions {
  /** Saved value from the server; ignored until `isSuccess` is true. */
  remote: string | null | undefined;
  /** True once the saved-value read has succeeded. */
  isSuccess: boolean;
}

export interface UseRemoteStringDraftResult {
  /** Unsaved local edit; '' when unset. */
  draft: string;
  setDraft: (value: string) => void;
  /** The draft differs from the last known saved value. */
  dirty: boolean;
  /** The saved value changed remotely while the local draft was kept. */
  remoteChanged: boolean;
  /** Adopt a just-saved value as the local baseline; call from the mutation's onSuccess. */
  acceptSaved: (value: string | null) => void;
  /** Discard the draft and adopt the current saved value. */
  reload: () => void;
}

/**
 * One nullable-string draft for an org setting that is read remotely and can
 * change under the administrator: hydration, dirty tracking, remote-change
 * reconciliation and the explicit reload live here so every such setting
 * behaves identically; each page keeps its own choice validation and copy.
 */
export function useRemoteStringDraft({ remote, isSuccess }: UseRemoteStringDraftOptions): UseRemoteStringDraftResult {
  const [draft, setDraft] = useState('');
  const [remoteChanged, setRemoteChanged] = useState(false);
  const savedBaseline = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!isSuccess) return;
    const saved = remote ?? null;
    if (savedBaseline.current === undefined) {
      savedBaseline.current = saved;
      setDraft(saved ?? '');
      return;
    }
    if (saved === savedBaseline.current) return;
    const local = draft || null;
    if (local !== savedBaseline.current) {
      setRemoteChanged(true);
      return;
    }
    savedBaseline.current = saved;
    setDraft(saved ?? '');
    setRemoteChanged(false);
  }, [draft, remote, isSuccess]);

  const acceptSaved = useCallback((value: string | null) => {
    savedBaseline.current = value;
    setRemoteChanged(false);
  }, []);

  const reload = useCallback(() => {
    const saved = remote ?? null;
    savedBaseline.current = saved;
    setDraft(saved ?? '');
    setRemoteChanged(false);
  }, [remote]);

  return {
    draft,
    setDraft,
    dirty: draft !== (savedBaseline.current ?? ''),
    remoteChanged,
    acceptSaved,
    reload,
  };
}
