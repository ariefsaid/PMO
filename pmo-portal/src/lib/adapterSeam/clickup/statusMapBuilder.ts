/**
 * Shared per-List status-map builder (OD-INT-10). This is the ONE place both `external-link` and
 * `clickup-onboard` build a `ClickUpStatusMap` from a List's configured statuses — the two edge
 * functions drifted before this existed: `external-link` shipped `statusMap: {}` (every outbound
 * write then throws `commit-rejected` — `statusMap.ts:toClickUpStatus`), while `clickup-onboard`'s
 * bespoke `captureMaps` only ever mapped PMO `To Do`/`Done`, leaving `In Progress`/`Blocked`
 * unmapped and treating only ClickUp's `closed` type (not `done`) as complete. Confined to
 * `clickup/**` (FR-CUA-012); keyed on ClickUp status **type** (`open|custom|closed|done`), never on
 * name — names are workspace-specific, types are not.
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
 * Outbound (`pmoToClickUp`):
 *  - `To Do`       -> the first `open`-type status (by `orderindex`)
 *  - `Done`        -> the first `done`-type status if present, else the first `closed`-type
 *  - `In Progress` -> the first `custom`-type status if present, else the `To Do` target
 *  - `Blocked`     -> a SECOND, distinct `custom`-type status if one exists, else the same target
 *                     as `In Progress` — this collapsed case is a valid MAP but an INVALID binding;
 *                     `statusMapCoversAllPmoStatuses` below rejects it (security audit, round 2).
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
  // Blocked collapses onto In Progress rather than being left unmapped (every PMO status MUST get
  // an outbound target — see statusMapCoversAllPmoStatuses below).
  const distinctBlockedStatus = customs.length > 1 ? customs[1].status : undefined;
  const blockedStatus = distinctBlockedStatus ?? inProgressStatus;

  const pmoToClickUp: Record<string, string> = {};
  if (toDoStatus) pmoToClickUp['To Do'] = toDoStatus;
  if (inProgressStatus) pmoToClickUp['In Progress'] = inProgressStatus;
  if (doneStatus) pmoToClickUp['Done'] = doneStatus;
  if (blockedStatus) pmoToClickUp['Blocked'] = blockedStatus;

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

  return { pmoToClickUp, clickUpToPmo, defaultPmoStatus: 'To Do' };
}

/**
 * OD-INT-10: a binding is safe to activate ONLY once every PMO status has a DISTINCT outbound
 * target. Callers (link-time validation) must reject a binding for which this returns `false`
 * rather than persist a config that either `commit-rejected`s on the first outbound write of an
 * unmapped status, or — the collapse case fixed by the security audit (round 2) — silently writes
 * two different PMO statuses (most commonly `Blocked` and `In Progress`, when a List has only one
 * `custom`-type status) to the SAME ClickUp status. A collapsed target corrupts state in both
 * directions: the outbound write loses which PMO status was intended, and the inbound read-back can
 * never recover it — for `Blocked` specifically, this silently destroys delivery-reporting signal
 * (S-curve/health reads are computed off task status). If a List cannot represent all four PMO
 * statuses as four distinct ClickUp statuses, the link must be rejected — the fix is to add another
 * status of the needed type in ClickUp, not to collapse two PMO states into one silently.
 */
export function statusMapCoversAllPmoStatuses(map: ClickUpStatusMap): boolean {
  const targets = PMO_TASK_STATUSES.map((status) => map.pmoToClickUp[status]);
  if (!targets.every((target) => Boolean(target))) return false;
  return new Set(targets).size === targets.length;
}
