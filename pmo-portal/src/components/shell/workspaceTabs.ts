import type { IconName } from '@/src/components/ui/icons';

export type TabKind = 'module' | 'record';

export interface WorkspaceTab {
  /** module: route key e.g. 'sales'; record: `${kind}:${routeId}` e.g. 'project:PRJ-0142'. */
  id: string;
  kind: TabKind;
  /** Canonical URL this tab maps to. */
  path: string;
  icon: IconName;
  label: string;
  /** Mono id badge for record tabs (OPP-/PR-/PRJ-). */
  code?: string;
  /** Amber dirty dot — driven by real unsaved/in-progress state. */
  dirty?: boolean;
  /** Owning rail group key (record tabs map to their parent module). */
  module: string;
}

export interface WorkspaceState {
  tabs: WorkspaceTab[];
  activeId: string;
}

export const DASHBOARD_TAB: WorkspaceTab = {
  id: 'dashboard',
  kind: 'module',
  path: '/',
  icon: 'grid',
  label: 'Dashboard',
  module: 'dashboard',
};

export const INITIAL_STATE: WorkspaceState = {
  tabs: [DASHBOARD_TAB],
  activeId: 'dashboard',
};

export type WorkspaceAction =
  | { type: 'open'; tab: WorkspaceTab }
  | { type: 'select'; id: string }
  | { type: 'close'; id: string }
  | { type: 'setDirty'; id: string; dirty: boolean }
  | { type: 'hydrate'; state: WorkspaceState };

/** The dashboard module tab is permanently non-closable. */
export function isClosable(tab: WorkspaceTab): boolean {
  return tab.id !== DASHBOARD_TAB.id;
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'open': {
      const existing = state.tabs.find((t) => t.id === action.tab.id);
      if (existing) {
        // Refocus — keep the richer of the two labels (hydrated label wins).
        const merged = { ...existing, ...action.tab, label: action.tab.label || existing.label };
        return {
          tabs: state.tabs.map((t) => (t.id === merged.id ? merged : t)),
          activeId: merged.id,
        };
      }
      return { tabs: [...state.tabs, action.tab], activeId: action.tab.id };
    }
    case 'select': {
      if (!state.tabs.some((t) => t.id === action.id)) return state;
      return { ...state, activeId: action.id };
    }
    case 'close': {
      const idx = state.tabs.findIndex((t) => t.id === action.id);
      if (idx === -1) return state;
      const tab = state.tabs[idx];
      if (!isClosable(tab)) return state;
      const tabs = state.tabs.filter((t) => t.id !== action.id);
      let activeId = state.activeId;
      if (state.activeId === action.id) {
        // Activate the previous tab.
        activeId = tabs[Math.max(0, idx - 1)]?.id ?? DASHBOARD_TAB.id;
      }
      return { tabs, activeId };
    }
    case 'setDirty': {
      return {
        ...state,
        tabs: state.tabs.map((t) => (t.id === action.id ? { ...t, dirty: action.dirty } : t)),
      };
    }
    case 'hydrate': {
      // Defensive: never lose the dashboard tab on rehydrate.
      const hasDashboard = action.state.tabs.some((t) => t.id === DASHBOARD_TAB.id);
      const tabs = hasDashboard ? action.state.tabs : [DASHBOARD_TAB, ...action.state.tabs];
      const activeId = tabs.some((t) => t.id === action.state.activeId)
        ? action.state.activeId
        : DASHBOARD_TAB.id;
      return { tabs, activeId };
    }
    default:
      return state;
  }
}

export const STORAGE_KEY = 'pmo.workspace.tabs';
export const VIEWS_STORAGE_KEY = 'pmo.workspace.views';
