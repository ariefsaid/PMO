/**
 * usePanelQueries — runs each compiled panel's query independently and exposes results keyed by
 * panel id. A panel settles as soon as its own query does (a slow panel never holds the others
 * in skeleton), and every completion, including retries, is dropped if the panel set was
 * replaced meanwhile (view change / recompose), so old data never lands in a newer view.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { executeCompiledQuery } from '@/src/lib/viewspec/executor';
import type { CompiledPanel } from '@/src/lib/viewspec/types';

export interface PanelQueryState {
  loading: boolean;
  data: unknown[] | null;
  error: Error | null;
}

export const PANEL_LOADING: PanelQueryState = { loading: true, data: null, error: null };

export function usePanelQueries(panels: CompiledPanel[] | null) {
  const [states, setStates] = useState<Record<string, PanelQueryState>>({});
  const gen = useRef(0);

  const run = useCallback((panel: CompiledPanel, myGen: number) => {
    const settle = (s: PanelQueryState) => {
      if (gen.current === myGen) setStates((prev) => ({ ...prev, [panel.id]: s }));
    };
    executeCompiledQuery(panel.compiledQuery).then(
      (rows) => settle({ loading: false, data: rows as unknown[], error: null }),
      (err: Error) => settle({ loading: false, data: null, error: err }),
    );
  }, []);

  useEffect(() => {
    const myGen = ++gen.current;
    if (!panels) {
      setStates({});
      return;
    }
    setStates(Object.fromEntries(panels.map((p) => [p.id, PANEL_LOADING])));
    panels.forEach((p) => run(p, myGen));
    return () => {
      gen.current = myGen + 1;
    };
  }, [panels, run]);

  const retry = useCallback(
    (panel: CompiledPanel) => {
      setStates((prev) => ({ ...prev, [panel.id]: PANEL_LOADING }));
      run(panel, gen.current);
    },
    [run],
  );

  return { states, retry };
}
