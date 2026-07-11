/**
 * Per-List ClickUp status map (FR-CUA-011). Confined to clickup/**: PMO status strings are the app's
 * own `task_status` enum values; ClickUp status strings are that List's configured status names.
 */
import { AdapterError } from '../contract.ts';

export interface ClickUpStatusMap {
  /** PMO status -> the List's configured ClickUp status string. */
  pmoToClickUp: Record<string, string>;
  /** ClickUp status string -> PMO status (may legitimately differ from a pure inverse). */
  clickUpToPmo: Record<string, string>;
  /** Fallback PMO status for an inbound ClickUp status with no configured mapping (FR-CUA-011). */
  defaultPmoStatus: string;
}

/** Outbound: PMO status -> the List's ClickUp status string. Throws when unmapped (config error). */
export function toClickUpStatus(map: ClickUpStatusMap, pmoStatus: string): string {
  const mapped = map.pmoToClickUp[pmoStatus];
  if (!mapped) {
    throw new AdapterError('commit-rejected', `no ClickUp status mapped for PMO status "${pmoStatus}"`);
  }
  return mapped;
}

/**
 * Inbound: ClickUp status string -> PMO status. An unmapped ClickUp status is NOT a hard failure
 * (FR-CUA-011) — it is logged and the configured default PMO status is used instead, so an unmapped
 * inbound status never blocks the read/apply path.
 */
export function fromClickUpStatus(map: ClickUpStatusMap, clickUpStatus: string): string {
  const mapped = map.clickUpToPmo[clickUpStatus];
  if (mapped) return mapped;
  console.warn(`[clickup] no PMO status mapped for ClickUp status "${clickUpStatus}" — using default`);
  return map.defaultPmoStatus;
}
