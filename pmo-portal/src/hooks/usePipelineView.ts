import { useCallback, useState } from 'react';
import { VIEWS_STORAGE_KEY } from './viewStorage';

/** The two Sales Pipeline body layouts (ViewToggle options). */
export const PIPELINE_VIEWS = ['kanban', 'table'] as const;
export type PipelineView = (typeof PIPELINE_VIEWS)[number];

export const DEFAULT_PIPELINE_VIEW: PipelineView = 'kanban';

function isPipelineView(v: unknown): v is PipelineView {
  return (PIPELINE_VIEWS as readonly unknown[]).includes(v);
}

/**
 * Reads the persisted Sales Pipeline body view from the per-surface views map in
 * sessionStorage (`VIEWS_STORAGE_KEY`). Defaults to `kanban` when nothing is
 * stored, the map is unparseable, or the stored value is out of range. The map
 * is shared with other surfaces — only the `pipeline` key is read.
 */
export function readPipelineView(): PipelineView {
  if (typeof sessionStorage === 'undefined') return DEFAULT_PIPELINE_VIEW;
  try {
    const raw = sessionStorage.getItem(VIEWS_STORAGE_KEY);
    if (!raw) return DEFAULT_PIPELINE_VIEW;
    const map = JSON.parse(raw) as Record<string, unknown>;
    return isPipelineView(map.pipeline) ? map.pipeline : DEFAULT_PIPELINE_VIEW;
  } catch {
    return DEFAULT_PIPELINE_VIEW;
  }
}

/**
 * Persists the Sales Pipeline body view, merging into the shared views map so
 * sibling surfaces' view keys are preserved. Storage failures (quota / private
 * mode) are swallowed — view persistence is best-effort, never load-bearing.
 */
export function writePipelineView(view: PipelineView): void {
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
    map.pipeline = view;
    sessionStorage.setItem(VIEWS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* non-fatal */
  }
}

/** Stateful Sales Pipeline view selection, persisted per-surface. */
export function usePipelineView(): [PipelineView, (view: PipelineView) => void] {
  const [view, setView] = useState<PipelineView>(readPipelineView);
  const update = useCallback((next: PipelineView) => {
    setView(next);
    writePipelineView(next);
  }, []);
  return [view, update];
}
