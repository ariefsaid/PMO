/**
 * Drawer-UX persistence (Track D, §2.5, DEC-6) — per-device localStorage prefs
 * for the AssistantPanel's resizable width and dock/overlay mode.
 *
 * FR-AXP-024 (width, clamped 320-720, default 400) / FR-AXP-025 (mode, default
 * 'overlay'). No server/DB persistence — this is a per-device UX preference.
 * localStorage reads/writes are wrapped in try/catch: private-mode Safari (and
 * any environment where localStorage throws) must not crash the panel — the
 * in-memory state still works for the session, mirroring useTheme.ts's pattern.
 */
export const PANEL_WIDTH_KEY = 'pmo.agentPanel.width';
export const PANEL_MODE_KEY = 'pmo.agentPanel.mode';

export const PANEL_WIDTH_MIN = 320;
export const PANEL_WIDTH_MAX = 720;
export const PANEL_WIDTH_DEFAULT = 400;

export type PanelMode = 'overlay' | 'docked';
export const PANEL_MODE_DEFAULT: PanelMode = 'overlay';
export const PANEL_PREFS_CHANGED_EVENT = 'pmo.agentPanel.prefsChanged';

export interface PanelPrefsChangedDetail {
  width?: number;
  mode?: PanelMode;
}

export function clampPanelWidth(value: number): number {
  if (!Number.isFinite(value)) return PANEL_WIDTH_DEFAULT;
  return Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, value));
}

function notifyPanelPrefsChanged(detail: PanelPrefsChangedDetail): void {
  try {
    window.dispatchEvent(new CustomEvent(PANEL_PREFS_CHANGED_EVENT, { detail }));
  } catch {
    // Non-browser/test environments without CustomEvent support do not need host reflow.
  }
}

export function readPanelWidth(): number {
  try {
    const raw = window.localStorage.getItem(PANEL_WIDTH_KEY);
    if (raw === null) return PANEL_WIDTH_DEFAULT;
    const parsed = Number(raw);
    return clampPanelWidth(parsed);
  } catch {
    return PANEL_WIDTH_DEFAULT;
  }
}

export function writePanelWidth(width: number): void {
  const next = clampPanelWidth(width);
  try {
    window.localStorage.setItem(PANEL_WIDTH_KEY, String(next));
  } catch {
    // private-mode / storage-disabled: in-memory state still works this session.
  } finally {
    notifyPanelPrefsChanged({ width: next });
  }
}

export function readPanelMode(): PanelMode {
  try {
    const raw = window.localStorage.getItem(PANEL_MODE_KEY);
    return raw === 'docked' ? 'docked' : PANEL_MODE_DEFAULT;
  } catch {
    return PANEL_MODE_DEFAULT;
  }
}

export function writePanelMode(mode: PanelMode): void {
  try {
    window.localStorage.setItem(PANEL_MODE_KEY, mode);
  } catch {
    // private-mode / storage-disabled: in-memory state still works this session.
  } finally {
    notifyPanelPrefsChanged({ mode });
  }
}
