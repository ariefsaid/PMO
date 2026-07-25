/**
 * runMultiListSweep — the org-level multi-List sweep orchestrator (read-hygiene round 2, security
 * audit rejection). Pure + Deno-importable; `clickup-sweep/index.ts` is thin wiring around it (builds
 * the DB-side closures + calls this once per org).
 *
 * Fixes three findings simultaneously, all rooted in the OLD sweep merging N Lists' reads into ONE
 * shared org cursor + ONE ambiguously-resolved apply pass:
 *
 *  - SEC-HIGH-1 (shared watermark + 404-skip = permanent data loss): reads each bound List on ITS OWN
 *    cursor (`clickUpListRawChangesAcrossLists`, reads.ts) and advances EACH List's watermark
 *    independently, only after every change from THIS cycle applied successfully. A List that 404s is
 *    simply excluded from this cycle's advance set — its cursor is never touched by a healthy sibling's
 *    progress, so restoring it later resumes exactly where it left off (no skipped change).
 *
 *  - SEC-HIGH-2 (`include_timl` can mint into the WRONG project): a task already mapped via
 *    `external_refs` is resolved to ITS EXISTING project's binding (never re-guessed off whichever
 *    List happened to tag it this cycle — the old bug: `projectByClickUpTaskId` was overwritten by the
 *    last List enumerated). An UNMAPPED task tagged under MORE THAN ONE bound List this cycle is
 *    AMBIGUOUS — held (not adopted under an arbitrary project). This is not data loss: the watermark
 *    only advances past what was actually read, so any future edit to that task bumps its
 *    `date_updated` past the (now-advanced) cursor and re-surfaces it for another attempt.
 *
 *  - SEC-MEDIUM-6 (archived tasks vanish from the feed but the mirror never archives): every archived
 *    task id `pageListTasks` filtered out of the live change set is now surfaced
 *    (`archivedTaskIds`, reads.ts) and, for any that already has a PMO mirror, applied through
 *    `archiveMirror`.
 *
 * Failure isolation: only a 404 (a deleted/moved List) is caught per-List. Any OTHER read failure
 * (network, 5xx, 4xx) propagates out of this function BEFORE any watermark advances — matching
 * AC-CUA-044 ("unreachable adapter leaves the watermark untouched"), now correctly scoped: NO List's
 * cursor moves this cycle, not even one that itself read successfully before a sibling's failure (the
 * advance pass runs LAST, only after every read + apply + archive step in this cycle completed).
 */
import type { PmoRecord } from '../contract.ts';
import { CLICKUP_TIER, CLICKUP_TASKS_DOMAIN } from './adapter.ts';
import { clickUpTaskToPmoRecord } from './mapping.ts';
import { applyInboundChange, type ExternalRefSeed } from '../applyEngine.ts';
import { clickUpListRawChangesAcrossLists, type ClickUpListBindingRef } from './reads.ts';
import type { ClickUpClientDeps } from './client.ts';
import type { ClickUpStatusMap } from './statusMap.ts';
import type { ClickUpMemberMap } from './memberMap.ts';
import type { ClickUpTask } from './types.ts';

export interface MultiListSweepBinding {
  listId: string;
  projectId: string;
  statusMap: ClickUpStatusMap;
  memberMap: ClickUpMemberMap;
}

export interface MultiListSweepDeps {
  bindings: MultiListSweepBinding[];
  clientDeps: Pick<ClickUpClientDeps, 'fetchImpl' | 'token' | 'baseUrl' | 'rateLimiter' | 'onRateLimitInfo'>;
  /** This List's OWN cursor (SEC-HIGH-1 — never a shared/merged org-wide value). */
  readListWatermark: (listId: string) => Promise<string | null>;
  advanceListWatermark: (listId: string, cursor: string) => Promise<void>;
  /** The List 404'd this cycle (deleted/moved) — mark its binding unhealthy (P4 health surface). */
  markListUnhealthy: (listId: string) => Promise<void>;
  resolvePmoRecordId: (externalRecordId: string) => Promise<string | null>;
  readMirrorSourceMod: (pmoRecordId: string) => Promise<number | null>;
  /** Resolve the project an EXISTING mirror actually belongs to (SEC-HIGH-2's deterministic-resolution
   *  source of truth), independent of which List tagged the task this cycle. */
  readMirrorProjectId: (pmoRecordId: string) => Promise<string | null>;
  updateMirror: (pmoRecordId: string, canonical: PmoRecord, sourceUpdatedAtMs: number) => Promise<void>;
  mintMirror: (canonical: PmoRecord, sourceUpdatedAtMs: number, projectId: string) => Promise<string>;
  recordExternalRef: (mapping: ExternalRefSeed) => Promise<void>;
  /** SEC-MEDIUM-6: archive an existing mirror for a ClickUp task now reported as archived. */
  archiveMirror: (pmoRecordId: string) => Promise<void>;
  /** OD-INT-9 parent sync (inbound): resolve ClickUp `parent` to a PMO task id via `external_refs`
   *  (same table the dispatch factory uses). Optional — when absent or unresolvable, the child
   *  flows through as a flat task; the next sweep re-applies and resolves it once the parent exists. */
  resolveParentPmoId?: (clickUpParentId: string) => Promise<string | null>;
}

export interface MultiListSweepPerListResult {
  listId: string;
  nextCursor: string | null;
  notFound?: boolean;
}

export interface MultiListSweepResult {
  /** Changes that applied (upsert or adopt) this run. A stale (per-row-guard no-op) or ambiguously-held
   *  change does not count. */
  applied: number;
  /** Existing mirrors archived this run (SEC-MEDIUM-6). */
  archived: number;
  /** Unmapped tasks seen under more than one bound List this cycle, held rather than adopted (SEC-HIGH-2). */
  skippedAmbiguous: number;
  perList: MultiListSweepPerListResult[];
}

/** Run one multi-List sweep cycle for an employing org. */
export async function runMultiListSweep(deps: MultiListSweepDeps): Promise<MultiListSweepResult> {
  const bindingByListId = new Map(deps.bindings.map((b) => [b.listId, b]));
  const bindingByProjectId = new Map(deps.bindings.map((b) => [b.projectId, b]));

  // ── 1. Read every bound List on its OWN cursor (SEC-HIGH-1). A non-404 failure propagates here,
  //    before any watermark advance below. ──
  const listsWithCursor: ClickUpListBindingRef[] = await Promise.all(
    deps.bindings.map(async (b) => ({
      listId: b.listId,
      statusMap: b.statusMap,
      memberMap: b.memberMap,
      cursor: await deps.readListWatermark(b.listId),
    })),
  );
  const { changes: tagged, archivedTaskIds, perListNextCursor, notFoundListIds } = await clickUpListRawChangesAcrossLists(
    listsWithCursor,
    deps.clientDeps,
  );

  for (const listId of notFoundListIds) {
    await deps.markListUnhealthy(listId);
  }

  const perList: MultiListSweepPerListResult[] = deps.bindings.map((b) => ({
    listId: b.listId,
    nextCursor: perListNextCursor[b.listId] ?? null,
    ...(notFoundListIds.includes(b.listId) ? { notFound: true } : {}),
  }));

  // ── 2. Dedup: the SAME ClickUp task can be tagged under more than one bound List this cycle
  //    (`include_timl=true`). Keep the first occurrence's payload — identical across tags. ──
  const firstOccurrence = new Map<string, { task: ClickUpTask; listId: string }>();
  const listsSeenByTaskId = new Map<string, Set<string>>();
  for (const t of tagged) {
    if (!firstOccurrence.has(t.task.id)) firstOccurrence.set(t.task.id, t);
    if (!listsSeenByTaskId.has(t.task.id)) listsSeenByTaskId.set(t.task.id, new Set());
    listsSeenByTaskId.get(t.task.id)!.add(t.listId);
  }

  // ── 3. Apply each unique task through the deterministic project-resolved, source-mod-guarded path
  //    (SEC-HIGH-2). ──
  let applied = 0;
  let skippedAmbiguous = 0;
  for (const [taskId, { task, listId }] of firstOccurrence) {
    const existingPmoId = await deps.resolvePmoRecordId(taskId);
    let resolvedBinding: MultiListSweepBinding | undefined;
    let mintProjectId: string | undefined;

    if (existingPmoId) {
      // Already mapped: keep its EXISTING project, never re-guessed off this cycle's tagging.
      const existingProjectId = await deps.readMirrorProjectId(existingPmoId);
      resolvedBinding = existingProjectId ? bindingByProjectId.get(existingProjectId) : undefined;
    } else {
      const seenLists = listsSeenByTaskId.get(taskId)!;
      if (seenLists.size > 1) {
        // Unmapped + shared across >1 bound List this cycle: ambiguous. Do NOT adopt into an
        // arbitrary project — held, not lost (a future edit re-surfaces it).
        skippedAmbiguous += 1;
        continue;
      }
      resolvedBinding = bindingByListId.get(listId);
      mintProjectId = resolvedBinding?.projectId;
    }

    const effectiveBinding = resolvedBinding ?? bindingByListId.get(listId);
    if (!effectiveBinding) continue; // defensive: no binding resolvable at all (shouldn't happen)

    // OD-INT-9 parent sync (inbound): resolve ClickUp `parent` to a PMO task id via `external_refs`.
    // The pure mapper has no DB access, so the lookup happens here and the resolved PMO id is
    // threaded in — exactly like `currentPmoStatus` in the webhook path. When the parent is
    // unresolvable (not yet mirrored), the child flows through as a flat task; the next sweep
    // re-applies and resolves it.
    let resolvedParentPmoId: string | null | undefined;
    if (task.parent && deps.resolveParentPmoId) {
      resolvedParentPmoId = await deps.resolveParentPmoId(task.parent);
      // Cross-project parent guard: if the resolved parent is in a different project than the
      // child's binding, refuse the link (log and null it). The child's project is the binding's
      // project (effectiveBinding.projectId for this task).
      if (resolvedParentPmoId) {
        const parentProjectId = await deps.readMirrorProjectId(resolvedParentPmoId);
        const childProjectId = effectiveBinding.projectId;
        if (parentProjectId && childProjectId && parentProjectId !== childProjectId) {
          console.warn(`[clickup-sweep] cross-project parent refused: parent ${resolvedParentPmoId} in project ${parentProjectId}, child in ${childProjectId}`);
          resolvedParentPmoId = null;
        }
      }
    }

    const canonical = clickUpTaskToPmoRecord(task, {
      statusMap: effectiveBinding.statusMap,
      memberMap: effectiveBinding.memberMap,
    }, undefined, resolvedParentPmoId);
    const outcome = await applyInboundChange(
      { tier: CLICKUP_TIER, domain: CLICKUP_TASKS_DOMAIN },
      taskId,
      canonical,
      Number(task.date_updated),
      {
        resolvePmoRecordId: deps.resolvePmoRecordId,
        readMirrorSourceMod: deps.readMirrorSourceMod,
        updateMirror: deps.updateMirror,
        mintMirror: (c, mod) => deps.mintMirror(c, mod, mintProjectId ?? effectiveBinding.projectId),
        recordExternalRef: deps.recordExternalRef,
      },
    );
    if (outcome.kind === 'upserted') applied += 1;
  }

  // ── 4. Archive an existing mirror for every ClickUp task now reported archived (SEC-MEDIUM-6). ──
  let archived = 0;
  for (const taskId of archivedTaskIds) {
    const existingPmoId = await deps.resolvePmoRecordId(taskId);
    if (existingPmoId) {
      await deps.archiveMirror(existingPmoId);
      archived += 1;
    }
  }

  // ── 5. Advance watermarks LAST, only after every apply/archive above succeeded. A List absent from
  //    `perListNextCursor` (404'd, or nothing new since its own cursor) is never touched. Monotonic:
  //    re-read the CURRENT stored cursor right before writing (belt-and-braces against a concurrent
  //    sweep instance for the same org racing this one — mirrors applyEngine.ts's
  //    advanceWatermarkMonotonic) so this write can never rewind a cursor a concurrent run already
  //    advanced further. ──
  for (const [listId, candidateCursor] of Object.entries(perListNextCursor)) {
    const current = await deps.readListWatermark(listId);
    const currentMs = current !== null ? Number(current) : null;
    const candidateMs = Number(candidateCursor);
    const advanced = currentMs !== null && currentMs > candidateMs ? currentMs : candidateMs;
    await deps.advanceListWatermark(listId, String(advanced));
  }

  return { applied, archived, skippedAmbiguous, perList };
}