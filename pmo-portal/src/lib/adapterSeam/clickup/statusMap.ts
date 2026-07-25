/**
 * Per-List ClickUp status map (FR-CUA-011). Confined to clickup/**: PMO status strings are the app's
 * own `task_status` enum values; ClickUp status strings are that List's configured status names.
 *
 * Every PMO status MUST resolve to an explicit, recorded outcome (OD-INT-10, round 3) — but "no
 * ClickUp counterpart" is a valid outcome, not a config error: ClickUp ships only three default
 * statuses (`to do`/`in progress`/`complete`), and `Blocked` is a PMO management signal (an
 * escalation/dependency flag) that has no natural ClickUp equivalent. Forcing every List to grow a
 * fourth status before it may link inverts ADR-0055 (the external system owns its own domain
 * vocabulary). A PMO status therefore resolves to one of:
 *   - `{kind:'clickup', status}` — mapped normally (pushed outbound, read inbound), or
 *   - `{kind:'pmo-only'}`        — never pushed outbound (its other fields still sync), and never
 *                                  overwritten by an inbound sync (`fromClickUpStatus` below).
 * `resolveStatus` is the single place this discriminated view is derived; `pmoToClickUp`/
 * `pmoOnlyStatuses` are the storage shape (jsonb-friendly, and byte-for-byte back-compat with every
 * binding persisted before this round — `pmoOnlyStatuses` is optional and absent = none).
 */
import { AdapterError } from '../contract.ts';

export type ClickUpStatusResolution = { kind: 'clickup'; status: string } | { kind: 'pmo-only' };

export interface ClickUpStatusMap {
  /** PMO status -> the List's configured ClickUp status string, for statuses with a ClickUp
   *  counterpart. A pmo-only status (see `pmoOnlyStatuses`) deliberately has NO entry here. */
  pmoToClickUp: Record<string, string>;
  /** ClickUp status string -> PMO status (may legitimately differ from a pure inverse). */
  clickUpToPmo: Record<string, string>;
  /** Fallback PMO status for an inbound ClickUp status with no configured mapping (FR-CUA-011). */
  defaultPmoStatus: string;
  /** PMO statuses with no ClickUp counterpart — never pushed outbound, never overwritten by an
   *  inbound sync. Optional; absent/empty = none (every binding persisted before this round). */
  pmoOnlyStatuses?: string[];
}

/** The recorded resolution for one PMO status, or `undefined` if the binding never recorded one
 *  (a genuine config error — every PMO status MUST resolve to something, see the header comment). */
export function resolveStatus(map: ClickUpStatusMap, pmoStatus: string): ClickUpStatusResolution | undefined {
  const mapped = map.pmoToClickUp[pmoStatus];
  if (mapped) return { kind: 'clickup', status: mapped };
  if (map.pmoOnlyStatuses?.includes(pmoStatus)) return { kind: 'pmo-only' };
  return undefined;
}

/**
 * Outbound: PMO status -> the List's ClickUp status string, or `undefined` for a `pmo-only` status
 * (a legitimate configured outcome — the caller omits the status field from its ClickUp write; see
 * `mapping.ts:pmoTaskToClickUpBody`). Throws ONLY when the binding recorded no resolution at all for
 * this PMO status (a config error the binding-time validation should have already rejected).
 */
export function toClickUpStatus(map: ClickUpStatusMap, pmoStatus: string): string | undefined {
  const resolution = resolveStatus(map, pmoStatus);
  if (!resolution) {
    throw new AdapterError('commit-rejected', `no ClickUp status mapped for PMO status "${pmoStatus}"`);
  }
  return resolution.kind === 'clickup' ? resolution.status : undefined;
}

/**
 * Inbound: ClickUp status string -> PMO status. An unmapped ClickUp status is NOT a hard failure
 * (FR-CUA-011) — it is logged and the configured default PMO status is used instead, so an unmapped
 * inbound status never blocks the read/apply path.
 *
 * `currentPmoStatus` (optional — the PMO row's status BEFORE this inbound change, when known) makes
 * the resolution sticky in two cases, both required so an inbound sync never destroys a more specific
 * PMO-side state than ClickUp can represent:
 *   1. `pmo-only` is sticky: a row currently at a `pmo-only` status (e.g. `Blocked`) never moves out
 *      of it via inbound sync — only a PMO user changes it.
 *   2. An explicit collapse (two PMO statuses recorded against the SAME ClickUp status) is preserved:
 *      if the incoming ClickUp status is exactly what the CURRENT PMO status already resolves to
 *      outbound, nothing actually changed from ClickUp's point of view, so the more specific current
 *      status is kept rather than downgraded to `clickUpToPmo`'s single (less specific) default target.
 */
export function fromClickUpStatus(map: ClickUpStatusMap, clickUpStatus: string, currentPmoStatus?: string): string {
  if (currentPmoStatus !== undefined) {
    const currentResolution = resolveStatus(map, currentPmoStatus);
    if (currentResolution?.kind === 'pmo-only') {
      return currentPmoStatus;
    }
    if (currentResolution?.kind === 'clickup' && currentResolution.status === clickUpStatus) {
      return currentPmoStatus;
    }
  }
  const mapped = map.clickUpToPmo[clickUpStatus];
  if (mapped) return mapped;
  console.warn(`[clickup] no PMO status mapped for ClickUp status "${clickUpStatus}" — using default`);
  return map.defaultPmoStatus;
}
