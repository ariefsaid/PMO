/**
 * Shared per-List status-map builder (OD-INT-10). This is the ONE place both `external-link` and
 * `clickup-onboard` build a `ClickUpStatusMap` from a List's configured statuses — the two edge
 * functions drifted before this existed: `external-link` shipped `statusMap: {}` (every outbound
 * write then throws `commit-rejected` — `statusMap.ts:toClickUpStatus`), while `clickup-onboard`'s
 * bespoke `captureMaps` only ever mapped PMO `To Do`/`Done`, leaving `In Progress`/`Blocked`
 * unmapped and treating only ClickUp's `closed` type (not `done`) as complete. Confined to
 * `clickup/**` (FR-CUA-012); keyed on ClickUp status **type** (`open|custom|closed|done`), never on
 * name — names are workspace-specific, types are not.
 *
 * Round 3 (this task) reverts round 2's pairwise-distinctness requirement — too strict to ship: a
 * fresh ClickUp workspace ships only THREE default statuses (`to do`/`in progress`/`complete`, see
 * the committed fixture `_shared/testing/fixtures/clickup-webhook/list-statuses.json`), and forcing a
 * customer to add a fourth ClickUp status before they may link inverts ADR-0055 (the external system
 * owns its own domain vocabulary). `Blocked` now defaults to `pmo-only` (`statusMap.ts`) when the List
 * has no distinct, unused status to represent it — never silently collapsed onto In Progress's target
 * (round 2's fix for the WORSE bug: a silent collapse corrupts state in both directions, since the
 * outbound write loses which PMO status was intended and the inbound read-back can never recover it).
 */
import type { ClickUpStatusMap } from './statusMap.ts';

/** The shape ClickUp returns in `GET /list/{id}` -> `statuses[]` (extra fields ignored). */
export interface ClickUpListStatus {
  status: string;
  type: string;
  orderindex?: number;
}

/** PMO's `task_status` enum (`0001_init_schema.sql:23`) — every one MUST get an outbound target. */
export const PMO_TASK_STATUSES = ['To Do', 'In Progress', 'Done', 'Blocked'] as const;
export type PmoTaskStatus = (typeof PMO_TASK_STATUSES)[number];

/**
 * Build a `ClickUpStatusMap` from a List's configured statuses.
 *
 * Outbound (`pmoToClickUp`, plus `pmoOnlyStatuses` for a status with no ClickUp counterpart):
 *  - `To Do`       -> the first `open`-type status (by `orderindex`)
 *  - `Done`        -> the first `done`-type status if present, else the first `closed`-type
 *  - `In Progress` -> the first `custom`-type status if present, else the `To Do` target (unchanged
 *                     from before this task — a List with no `custom`-type status at all still has no
 *                     way to represent In Progress distinctly, and that's an existing, accepted gap
 *                     this task does not extend)
 *  - `Blocked`     -> a SECOND, distinct `custom`-type status if one exists, else `pmo-only` (round
 *                     3, this task) — NEVER silently collapsed onto In Progress's target (round 2's
 *                     fix for exactly that corruption). `Blocked` is a PMO management signal
 *                     (escalation/dependency) with no natural ClickUp equivalent in the default
 *                     three-status vocabulary; `pmo-only` records that explicitly instead of forcing
 *                     every List to grow a fourth status before it may link (ADR-0055).
 *
 * Inbound (`clickUpToPmo`), for every configured status:
 *  - `closed`/`done` -> `Done` · `open` -> `To Do` · `custom` -> `In Progress`, except the one
 *    status (if any) picked as the `Blocked` target above, which maps back to `Blocked`.
 *  - any other/unrecognised type is left unmapped — `fromClickUpStatus` falls back to
 *    `defaultPmoStatus` for it (logged, never thrown).
 */
export function buildClickUpStatusMap(statuses: ClickUpListStatus[]): ClickUpStatusMap {
  const sorted = [...statuses].sort((a, b) => (a.orderindex ?? 0) - (b.orderindex ?? 0));
  const opens = sorted.filter((s) => s.type === 'open');
  const customs = sorted.filter((s) => s.type === 'custom');
  const dones = sorted.filter((s) => s.type === 'done');
  const closed = sorted.filter((s) => s.type === 'closed');

  const toDoStatus = opens[0]?.status;
  const doneStatus = dones[0]?.status ?? closed[0]?.status;
  const inProgressStatus = customs[0]?.status ?? toDoStatus;
  // A second, distinct custom status (if the List has one) becomes the Blocked target; otherwise
  // Blocked has no distinct ClickUp counterpart and resolves pmo-only (see the doc comment above) —
  // this is deliberate, never a silent collapse onto In Progress's target.
  const distinctBlockedStatus = customs.length > 1 ? customs[1].status : undefined;

  const pmoToClickUp: Record<string, string> = {};
  if (toDoStatus) pmoToClickUp['To Do'] = toDoStatus;
  if (inProgressStatus) pmoToClickUp['In Progress'] = inProgressStatus;
  if (doneStatus) pmoToClickUp['Done'] = doneStatus;
  if (distinctBlockedStatus) pmoToClickUp['Blocked'] = distinctBlockedStatus;

  const pmoOnlyStatuses: string[] = [];
  if (!distinctBlockedStatus) pmoOnlyStatuses.push('Blocked');

  const clickUpToPmo: Record<string, string> = {};
  for (const s of sorted) {
    if (s.type === 'closed' || s.type === 'done') {
      clickUpToPmo[s.status] = 'Done';
    } else if (s.type === 'open') {
      clickUpToPmo[s.status] = 'To Do';
    } else if (s.type === 'custom') {
      clickUpToPmo[s.status] = s.status === distinctBlockedStatus ? 'Blocked' : 'In Progress';
    }
    // Any other type is intentionally left unmapped (see doc comment above).
  }

  return { pmoToClickUp, clickUpToPmo, defaultPmoStatus: 'To Do', pmoOnlyStatuses };
}

/**
 * OD-INT-10 (round 3): a binding is safe to activate ONLY once every PMO status has an EXPLICIT,
 * RECORDED resolution — mapped to a real ClickUp status, or explicitly `pmo-only` (`statusMap.ts`).
 * Callers (link-time validation) must reject a binding for which this returns `false` rather than
 * persist a config that `commit-rejected`s on the first outbound write of a genuinely unresolved
 * status.
 *
 * Distinctness among the mapped (non-pmo-only) targets is NO LONGER required here (round 2's
 * pairwise-distinctness rule was too strict — a fresh ClickUp workspace ships only three default
 * statuses and would always fail it). Two PMO statuses sharing one ClickUp status is still only ever
 * VALID when explicitly recorded (never produced silently by `buildClickUpStatusMap` above); when it
 * is explicit, `statusMap.ts:fromClickUpStatus`'s stickiness keeps the more specific PMO status from
 * being downgraded by an inbound sync.
 */
export function statusMapCoversAllPmoStatuses(map: ClickUpStatusMap): boolean {
  const pmoOnly = new Set(map.pmoOnlyStatuses ?? []);
  return PMO_TASK_STATUSES.every((status) => Boolean(map.pmoToClickUp[status]) || pmoOnly.has(status));
}
