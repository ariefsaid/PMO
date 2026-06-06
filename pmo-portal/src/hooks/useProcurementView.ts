import { useCallback, useState } from 'react';
import { VIEWS_STORAGE_KEY } from '@/src/components/shell/workspaceTabs';

/** The two Procurement body layouts (ViewToggle options). */
export type ProcurementView = 'table' | 'board';

const DEFAULT_VIEW: ProcurementView = 'table';

function isProcurementView(v: unknown): v is ProcurementView {
  return v === 'table' || v === 'board';
}

/**
 * Reads the persisted Procurement body view from the per-surface views map in
 * sessionStorage (`VIEWS_STORAGE_KEY`). Defaults to `table` when nothing is
 * stored, the map is unparseable, or the stored value is out of range. Only the
 * `procurement` key is read — the map is shared with sibling surfaces.
 */
export function readProcurementView(): ProcurementView {
  if (typeof sessionStorage === 'undefined') return DEFAULT_VIEW;
  try {
    const raw = sessionStorage.getItem(VIEWS_STORAGE_KEY);
    if (!raw) return DEFAULT_VIEW;
    const map = JSON.parse(raw) as Record<string, unknown>;
    return isProcurementView(map.procurement) ? map.procurement : DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
}

/**
 * Persists the Procurement body view, merging into the shared views map so
 * sibling surfaces' view keys are preserved. Storage failures (quota / private
 * mode) are swallowed — view persistence is best-effort, never load-bearing.
 */
export function writeProcurementView(view: ProcurementView): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    let map: Record<string, unknown> = {};
    const raw = sessionStorage.getItem(VIEWS_STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') map = parsed as Record<string, unknown>;
      } catch {
        /* corrupt map — overwrite with a fresh one */
      }
    }
    map.procurement = view;
    sessionStorage.setItem(VIEWS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* non-fatal */
  }
}

/** Stateful Procurement view selection, persisted per-surface. */
export function useProcurementView(): [ProcurementView, (view: ProcurementView) => void] {
  const [view, setView] = useState<ProcurementView>(readProcurementView);
  const update = useCallback((next: ProcurementView) => {
    setView(next);
    writeProcurementView(next);
  }, []);
  return [view, update];
}
