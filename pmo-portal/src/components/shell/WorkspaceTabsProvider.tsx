import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  INITIAL_STATE,
  STORAGE_KEY,
  workspaceReducer,
  type WorkspaceState,
  type WorkspaceTab,
} from './workspaceTabs';
import { moduleTab, tabForPath } from './routeMatch';

export interface WorkspaceContextValue {
  tabs: WorkspaceTab[];
  activeId: string;
  /** Open (or refocus) a top-level module and navigate there. */
  openModule: (moduleKey: string) => void;
  /** Open (or refocus) a record tab and navigate to its path. */
  openRecord: (tab: WorkspaceTab) => void;
  /** Close a tab; if active, activates the previous one and navigates there. */
  closeTab: (id: string) => void;
  /** Select an existing tab and navigate to its path. */
  selectTab: (id: string) => void;
  /** Flip the amber dirty dot for a tab (real unsaved/in-progress state). */
  setDirty: (id: string, dirty: boolean) => void;
}

const Ctx = createContext<WorkspaceContextValue | undefined>(undefined);

function readInitialState(): WorkspaceState {
  if (typeof sessionStorage === 'undefined') return INITIAL_STATE;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return INITIAL_STATE;
    const parsed = JSON.parse(raw) as WorkspaceState;
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return INITIAL_STATE;
    return workspaceReducer(INITIAL_STATE, { type: 'hydrate', state: parsed });
  } catch {
    return INITIAL_STATE;
  }
}

export const WorkspaceTabsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [state, dispatch] = useReducer(workspaceReducer, undefined, readInitialState);

  // Persist to sessionStorage (debounced) on change.
  const persistTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (typeof sessionStorage === 'undefined') return;
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        /* quota / private mode — non-fatal */
      }
    }, 150);
    return () => clearTimeout(persistTimer.current);
  }, [state]);

  // URL is the source of truth: derive the tab from the current path and
  // open/refocus it. Handles deep links and browser Back/Forward.
  useEffect(() => {
    const tab = tabForPath(location.pathname);
    if (tab) dispatch({ type: 'open', tab });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on the path only
  }, [location.pathname]);

  const selectTab = useCallback(
    (id: string) => {
      const tab = state.tabs.find((t) => t.id === id);
      if (!tab) return;
      dispatch({ type: 'select', id });
      if (tab.path !== location.pathname) navigate(tab.path);
    },
    [state.tabs, location.pathname, navigate]
  );

  const openModule = useCallback(
    (moduleKey: string) => {
      const tab = moduleTab(moduleKey);
      if (!tab) return;
      dispatch({ type: 'open', tab });
      if (tab.path !== location.pathname) navigate(tab.path);
    },
    [location.pathname, navigate]
  );

  const openRecord = useCallback(
    (tab: WorkspaceTab) => {
      dispatch({ type: 'open', tab });
      if (tab.path !== location.pathname) navigate(tab.path);
    },
    [location.pathname, navigate]
  );

  const closeTab = useCallback(
    (id: string) => {
      const idx = state.tabs.findIndex((t) => t.id === id);
      if (idx === -1) return;
      const wasActive = state.activeId === id;
      const remaining = state.tabs.filter((t) => t.id !== id);
      dispatch({ type: 'close', id });
      if (wasActive) {
        const next = remaining[Math.max(0, idx - 1)];
        if (next && next.path !== location.pathname) navigate(next.path);
      }
    },
    [state.tabs, state.activeId, location.pathname, navigate]
  );

  const setDirty = useCallback((id: string, dirty: boolean) => {
    dispatch({ type: 'setDirty', id, dirty });
  }, []);

  const value: WorkspaceContextValue = {
    tabs: state.tabs,
    activeId: state.activeId,
    openModule,
    openRecord,
    closeTab,
    selectTab,
    setDirty,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components -- hook co-located with its provider
export const useWorkspaceTabs = (): WorkspaceContextValue => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWorkspaceTabs must be used within a WorkspaceTabsProvider');
  return ctx;
};

/** Non-throwing accessor — for components that may be rendered with an injected
 *  ws prop in tests (returns undefined outside the provider). */
// eslint-disable-next-line react-refresh/only-export-components -- hook co-located with its provider
export const useWorkspaceTabsOptional = (): WorkspaceContextValue | undefined => useContext(Ctx);
