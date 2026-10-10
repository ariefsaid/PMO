import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';

type RecordContextState = {
  recordContext?: {
    listPath: string;
  };
};

/** Keeps a record addressable while remembering the exact filtered list that opened it. */
export function useRecordContext(basePath: string, recordId?: string) {
  const location = useLocation();
  const navigate = useNavigate();

  const openRecord = useCallback((id: string) => {
    const listPath = `${location.pathname}${location.search}${location.hash}`;
    navigate(`${basePath}/${encodeURIComponent(id)}${location.search}`, {
      state: { recordContext: { listPath } } satisfies RecordContextState,
    });
  }, [basePath, location.hash, location.pathname, location.search, navigate]);

  const closeRecord = useCallback(() => {
    const listPath = (location.state as RecordContextState | null)?.recordContext?.listPath;
    if (listPath && (listPath === basePath || listPath.startsWith(`${basePath}?`) || listPath.startsWith(`${basePath}#`))) {
      navigate(-1);
      return;
    }
    navigate(`${basePath}${location.search}`, { replace: true });
  }, [basePath, location.search, location.state, navigate]);

  return { recordId, openRecord, closeRecord };
}
