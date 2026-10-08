/**
 * #879 — Tab-switch navigation marker (router location.state).
 *
 * In-page tabs on record pages (ProjectDetail, ProcurementDetails) encode the active
 * tab in the URL, so every arrow-key tab switch is a real `navigate()`. AppShell's
 * focus-on-route-change therefore yanked focus out of the tab bar on every switch,
 * leaving keyboard users unable to arrow along the tabs (WCAG 2.4.3).
 *
 * Pages mark tab-switch navigations with `pmoTabSwitch` in location.state; AppShell
 * still moves focus to <main> on every OTHER pathname change (real navigation is
 * unchanged) but skips the yank for marked ones — the Tabs roving-focus handler has
 * already moved focus to the newly-activated tab (WAI-ARIA tabs pattern).
 */
export const TAB_SWITCH_NAV_STATE_KEY = 'pmoTabSwitch';

/** Returns the given router state with the tab-switch marker added (other keys preserved). */
export function withTabSwitchNavState(state: unknown): Record<string, unknown> {
  return { ...((state ?? {}) as Record<string, unknown>), [TAB_SWITCH_NAV_STATE_KEY]: true };
}

/** True when this location was reached by an in-page tab switch (see module doc). */
export function isTabSwitchNavState(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as Record<string, unknown>)[TAB_SWITCH_NAV_STATE_KEY] === true
  );
}
