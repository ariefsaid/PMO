import { useCallback, useState } from 'react';
import { VIEWS_STORAGE_KEY } from '@/src/components/shell/workspaceTabs';

/** The two Timesheets body layouts (ViewToggle options). */
export type TimesheetsView = 'grid' | 'approvals';

const DEFAULT_VIEW: TimesheetsView = 'grid';

function isTimesheetsView(v: unknown): v is TimesheetsView {
  return v === 'grid' || v === 'approvals';
}

/**
 * Reads the persisted Timesheets body view from the per-surface views map in
 * sessionStorage (`VIEWS_STORAGE_KEY`). Defaults to `grid` when nothing is
 * stored, the map is unparseable, or the stored value is out of range. Only the
 * `timesheets` key is read — the map is shared with sibling surfaces.
 */
export function readTimesheetsView(): TimesheetsView {
  if (typeof sessionStorage === 'undefined') return DEFAULT_VIEW;
  try {
    const raw = sessionStorage.getItem(VIEWS_STORAGE_KEY);
    if (!raw) return DEFAULT_VIEW;
    const map = JSON.parse(raw) as Record<string, unknown>;
    return isTimesheetsView(map.timesheets) ? map.timesheets : DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
}

/**
 * Persists the Timesheets body view, merging into the shared views map so
 * sibling surfaces' view keys are preserved. Storage failures (quota / private
 * mode) are swallowed — view persistence is best-effort, never load-bearing.
 */
export function writeTimesheetsView(view: TimesheetsView): void {
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
    map.timesheets = view;
    sessionStorage.setItem(VIEWS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* non-fatal */
  }
}

/** Stateful Timesheets view selection, persisted per-surface. */
export function useTimesheetsView(): [TimesheetsView, (view: TimesheetsView) => void] {
  const [view, setView] = useState<TimesheetsView>(readTimesheetsView);
  const update = useCallback((next: TimesheetsView) => {
    setView(next);
    writeTimesheetsView(next);
  }, []);
  return [view, update];
}
