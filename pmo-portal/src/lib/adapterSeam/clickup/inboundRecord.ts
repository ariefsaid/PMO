/**
 * resolveInboundRecord — the single place an inbound ClickUp task becomes the canonical record for its
 * mirror, shared by BOTH live apply paths (the webhook worker via `applyWebhookEvent`, and the
 * multi-List sweep). The pure mapper has no DB access, so everything it needs about the EXISTING
 * mirror is resolved here and threaded in:
 *   - current PMO status (OD-INT-10 stickiness: a `pmo-only` status is never moved out of, an explicit
 *     collapse never downgrades) — only for an already-mapped task;
 *   - parent link (OD-INT-9): a ClickUp `parent` resolves through `external_refs`; an unmirrored parent
 *     or one in another project yields `null` (flat until it converges). An explicit `parent: null`
 *     (a top-level task) clears `parent_task_id`; an ABSENT `parent` key leaves it OMITTED, so a payload
 *     that simply does not carry the field never flattens an existing PMO link.
 * Every dep is optional: absent = that facet is simply not resolved (the pre-existing behavior).
 */
import type { PmoRecord } from '../contract.ts';
import { clickUpTaskToPmoRecord, type ClickUpMaps } from './mapping.ts';
import type { ClickUpTask } from './types.ts';

export interface InboundResolveDeps {
  /** The mapped mirror's CURRENT PMO status. */
  readMirrorStatus?: (pmoRecordId: string) => Promise<string | null>;
  /** ClickUp parent task id → PMO task id via `external_refs` (null = not mirrored yet). */
  resolveParentPmoId?: (clickUpParentId: string) => Promise<string | null>;
  /** The project an existing mirror belongs to (cross-project parent guard). */
  readMirrorProjectId?: (pmoRecordId: string) => Promise<string | null>;
}

export interface InboundResolveCtx {
  /** The PMO id the task is already mapped to, or null for an unmapped (adopting) task. */
  mappedPmoId: string | null;
  /** The project the child lands in (binding project) — the cross-project guard's reference. */
  childProjectId?: string;
}

export async function resolveInboundRecord(
  task: ClickUpTask,
  maps: ClickUpMaps,
  deps: InboundResolveDeps,
  ctx: InboundResolveCtx,
): Promise<PmoRecord> {
  const currentPmoStatus =
    ctx.mappedPmoId !== null && deps.readMirrorStatus
      ? ((await deps.readMirrorStatus(ctx.mappedPmoId)) ?? undefined)
      : undefined;

  let parentPmoId: string | null | undefined;
  if (task.parent && deps.resolveParentPmoId) {
    parentPmoId = await deps.resolveParentPmoId(task.parent);
    if (parentPmoId && deps.readMirrorProjectId && ctx.childProjectId) {
      const parentProjectId = await deps.readMirrorProjectId(parentPmoId);
      // Fail closed: a parent whose project cannot be read (null) is not provably in the child's project.
      if (parentProjectId !== ctx.childProjectId) {
        console.warn(`[clickup] cross-project parent refused: parent ${parentPmoId} in project ${parentProjectId}, child in ${ctx.childProjectId}`);
        parentPmoId = null;
      }
    }
  } else if (task.parent === null) {
    parentPmoId = null;
  }

  return clickUpTaskToPmoRecord(task, maps, currentPmoStatus, parentPmoId);
}
