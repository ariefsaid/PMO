/** Deterministic, collision-safe ids so a tab + its panel can cross-reference (G4). */
export const tabId = (base: string, value: string) => `${base}-tab-${value}`;
export const tabPanelId = (base: string, value: string) => `${base}-tabpanel-${value}`;
