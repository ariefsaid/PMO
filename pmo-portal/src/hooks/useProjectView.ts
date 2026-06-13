import { useCallback, useState } from 'react';
import { VIEWS_STORAGE_KEY } from './viewStorage';

/** The Projects index body layouts (ViewToggle options): table, cards, calendar, or kanban board. */
export type ProjectView = 'table' | 'cards' | 'calendar' | 'kanban';

const DEFAULT_VIEW: ProjectView = 'table';

function isProjectView(v: unknown): v is ProjectView {
  return v === 'table' || v === 'cards' || v === 'calendar' || v === 'kanban';
}

/**
 * Reads the persisted Projects index view from the per-surface views map in
 * sessionStorage (`VIEWS_STORAGE_KEY`, `project` key). Defaults to `table`
 * (index-first per IA-3) when nothing is stored, the map is unparseable, or the
 * stored value is out of range. Only the `project` key is read — the map is
 * shared with sibling surfaces.
 */
export function readProjectView(): ProjectView {
  if (typeof sessionStorage === 'undefined') return DEFAULT_VIEW;
  try {
    const raw = sessionStorage.getItem(VIEWS_STORAGE_KEY);
    if (!raw) return DEFAULT_VIEW;
    const map = JSON.parse(raw) as Record<string, unknown>;
    return isProjectView(map.project) ? map.project : DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
}

/**
 * Persists the Projects index view, merging into the shared views map so
 * sibling surfaces' view keys are preserved. Storage failures (quota / private
 * mode) are swallowed — view persistence is best-effort, never load-bearing.
 */
export function writeProjectView(view: ProjectView): void {
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
    map.project = view;
    sessionStorage.setItem(VIEWS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* non-fatal */
  }
}

/** Stateful Projects index view selection, persisted per-surface. */
export function useProjectView(): [ProjectView, (view: ProjectView) => void] {
  const [view, setView] = useState<ProjectView>(readProjectView);
  const update = useCallback((next: ProjectView) => {
    setView(next);
    writeProjectView(next);
  }, []);
  return [view, update];
}
