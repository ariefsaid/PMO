/**
 * ClickUp onboarding both ways (FR-CUA-050/051/052/060/061/062/063/064, AC-CUA-050..053, OD-CUA-3).
 *
 * Pure + Deno-importable orchestrator (same idiom as commands.ts/reads.ts): ClickUp vocabulary is
 * confined HERE (it never crosses above the contract); PMO-side state is reached ONLY through
 * injected service-client callbacks, so every path is unit-testable with a mocked `fetch` and mocked
 * PMO callbacks — no live token (mocked-only in P1; live shapes re-verified in the appendix).
 *
 * Three operations, two clean directions (OD-CUA-3):
 *  - `provisionBinding` — create/bind one ClickUp List per project, capture the status/member maps,
 *    persist `external_project_bindings`, and pick the onboarding direction. BOTH the project and
 *    the List non-empty → REJECTED at provisioning ("List and project both non-empty — choose a
 *    clean direction"); an empty List → push-seed, an empty project → pull-adopt.
 *  - `pushSeed` — for each PMO task in the project, create one ClickUp task (mapping-set fields
 *    ONLY — FR-CUA-024/052) and record `external_refs` as the resumption ledger. Already-mapped
 *    tasks are skipped (idempotent + resumable, FR-CUA-050/051/092).
 *  - `pullAdopt` — enumerate the List via `listChangesSinceWatermark`, minting one mirrored
 *    read-model row + mapping per ClickUp task; already-mapped tasks refresh the mirror (idempotent),
 *    and a partial run resumes from the watermark (FR-CUA-060/061/062).
 *
 * All ClickUp calls run on the rate-limiter's BULK lane (NFR-CUA-PERF-003) so a live user's
 * interactive command is served ahead of an in-flight onboarding batch — reuse, not re-invention.
 */
import type { PmoRecord } from '../contract.ts';
import { clickUpRequest, type ClickUpClientDeps } from './client.ts';
import { pmoTaskToClickUpBody, type ClickUpMaps } from './mapping.ts';
import { clickUpListChangesSinceWatermark } from './reads.ts';
import type { ClickUpStatusMap } from './statusMap.ts';
import type { ClickUpMemberMap } from './memberMap.ts';
import type { ClickUpTask } from './types.ts';

/** The two clean onboarding directions (OD-CUA-3). */
export type OnboardingDirection = 'push-seed' | 'pull-adopt';

/** A persisted per-project external binding (the `external_project_bindings` row, PMO-shaped). */
export interface ProjectBinding {
  projectId: string;
  /** The external container id this project is bound to (a ClickUp List id — vocab confined here). */
  listId: string;
  statusMap: ClickUpStatusMap;
  memberMap: ClickUpMemberMap;
}

/**
 * A PMO task eligible to seed into ClickUp. The mapping-set fields are pushed; the enhancement
 * fields (milestone grouping, dependencies) are carried here so callers/tests can prove they are
 * NEVER sent to ClickUp (FR-CUA-024/052) — `pushSeed` builds a mapping-set-only ClickUp body.
 */
export interface PmoTaskRow {
  id: string;
  name: string;
  status: string;
  assignee_id: string | null;
  start_date: string | null;
  end_date: string | null;
  /** Enhancement — milestone grouping; never pushed (FR-CUA-024). */
  milestone_id?: string | null;
  /** Enhancement — dependency edges; never pushed (FR-CUA-024). */
  dependencies?: unknown;
}

/** An `external_refs` mapping seed (org is bound by the caller/edge-fn above this module — FR-EAS-024). */
export interface ExternalRefSeed {
  pmoRecordId: string;
  externalTier: string;
  externalRecordId: string;
  domain: string;
}

/** Shared ClickUp client + per-List maps for the bound project. */
export interface ClickUpBoundClientDeps extends ClickUpClientDeps {
  listId: string;
  statusMap: ClickUpStatusMap;
  memberMap: ClickUpMemberMap;
}

// ──────────────────────────────────────────────────────────────────────────────
// provisionBinding (FR-CUA-063, OD-CUA-3)
// ──────────────────────────────────────────────────────────────────────────────

export type ProvisioningTarget =
  | { kind: 'create'; folderId: string; name?: string }
  | { kind: 'bind'; listId: string };

export interface ProvisioningDeps extends ClickUpClientDeps {
  /** Create a new List under this Folder, or bind an existing List id. */
  target: ProvisioningTarget;
  /**
   * Capture the per-List status/member maps (FR-CUA-011/013). Fetches ClickUp statuses/members and
   * builds the maps — implemented by the clickup-onboard edge fn (live wire shapes are re-verified
   * in the deferred live-smoke appendix, same stance as mapping.ts).
   */
  captureMaps: (listId: string) => Promise<{ statusMap: ClickUpStatusMap; memberMap: ClickUpMemberMap }>;
  /** PMO side: count the project's tasks (the emptiness check for the onboarding direction). */
  countPmoTasks: (projectId: string) => Promise<number>;
  /** ClickUp side: count the List's tasks (0 for a freshly-created List). */
  countListTasks: (listId: string) => Promise<number>;
  /** Persist the per-project binding (`external_project_bindings` upsert). */
  upsertBinding: (binding: ProjectBinding) => Promise<void>;
}

export interface ProvisioningResult {
  direction: OnboardingDirection;
  binding: ProjectBinding;
}

/** The operator-facing reject-at-provisioning message (OD-CUA-3 — exact wording is specced). */
export const MIXED_ONBOARDING_MESSAGE = 'List and project both non-empty — choose a clean direction';

/** Create one ClickUp List under a Folder (REST v2 `POST /folder/{folder_id}/list`), bulk lane. */
async function createClickUpList(deps: ClickUpClientDeps, folderId: string, name: string): Promise<string> {
  const raw = (await clickUpRequest(deps, {
    method: 'POST',
    path: `/folder/${folderId}/list`,
    body: { name },
    priority: 'bulk',
  })) as { id: string };
  return raw.id;
}

/** Delete a ClickUp List (REST v2 `DELETE /list/{list_id}`), bulk lane — orphan-cleanup only, see
 *  `provisionBinding` below. Never called for `kind: 'bind'` (an existing List the org already owns). */
async function deleteClickUpList(deps: ClickUpClientDeps, listId: string): Promise<void> {
  await clickUpRequest(deps, { method: 'DELETE', path: `/list/${listId}`, priority: 'bulk' });
}

/**
 * Provision (or bind) one ClickUp List per project, capture its maps, persist the binding, and pick
 * the onboarding direction. Rejects the mixed case at provisioning (OD-CUA-3) BEFORE persisting.
 *
 * Orphan-List cleanup (security audit LOW, round 2): for `kind: 'create'`, the List must exist before
 * its statuses can be fetched/validated, so a rejection AFTER creation (an incomplete status map, or
 * the mixed-content case) would otherwise leave an orphan List sitting in the customer's ClickUp
 * workspace forever. Any rejection reached after we created the List triggers a best-effort DELETE of
 * that List; a cleanup failure is logged, never masks the original rejection, and `kind: 'bind'`
 * (an existing List the org already owns) is NEVER deleted.
 */
export async function provisionBinding(projectId: string, deps: ProvisioningDeps): Promise<ProvisioningResult> {
  const weCreatedIt = deps.target.kind === 'create';
  const listId =
    deps.target.kind === 'create'
      ? await createClickUpList(deps, deps.target.folderId, deps.target.name ?? projectId)
      : deps.target.listId;

  try {
    const { statusMap, memberMap } = await deps.captureMaps(listId);
    const pmoCount = await deps.countPmoTasks(projectId);
    const listCount = await deps.countListTasks(listId);

    if (pmoCount > 0 && listCount > 0) {
      // OD-CUA-3: reject the mixed case at provisioning — no half-provisioned binding is persisted.
      throw new Error(MIXED_ONBOARDING_MESSAGE);
    }

    // Empty List → push-seed (seed it from PMO); non-empty List (with an empty project) → pull-adopt.
    const direction: OnboardingDirection = listCount > 0 ? 'pull-adopt' : 'push-seed';
    const binding: ProjectBinding = { projectId, listId, statusMap, memberMap };
    await deps.upsertBinding(binding);
    return { direction, binding };
  } catch (err) {
    if (weCreatedIt) {
      await deleteClickUpList(deps, listId).catch((cleanupErr) => {
        console.error(`orphan ClickUp List ${listId} cleanup failed after a provisioning rejection`, cleanupErr);
      });
    }
    throw err;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// pushSeed (FR-CUA-050/051/052, AC-CUA-050/051/052)
// ──────────────────────────────────────────────────────────────────────────────

export interface PushSeedDeps extends ClickUpBoundClientDeps {
  /** The PMO tasks to seed (mapping-set fields + enhancements; only mapping-set fields are pushed). */
  listPmoTasks: (projectId: string) => Promise<PmoTaskRow[]>;
  /** Resolve an existing external mapping for a PMO task (`null` = not yet seeded). */
  resolveExternalId: (pmoRecordId: string) => Promise<string | null>;
  /** Record the `external_refs` mapping (the resumption ledger). */
  recordExternalRef: (mapping: ExternalRefSeed) => Promise<void>;
}

export interface PushSeedResult {
  /** PMO tasks newly created in ClickUp this run. */
  seeded: number;
  /** PMO tasks already mapped (skipped — never double-created). */
  skipped: number;
}

/**
 * Seed PMO tasks into an empty ClickUp List (FR-CUA-050). One ClickUp `create` per PMO task
 * (mapping-set fields only — FR-CUA-052/024), recording `external_refs` per task so a partial
 * failure resumes by skipping the already-mapped remainder (FR-CUA-051/092). The read-model row is
 * left in place — it becomes the mirror (FR-CUA-050). Bulk lane throughout (NFR-CUA-PERF-003).
 */
export async function pushSeed(projectId: string, deps: PushSeedDeps): Promise<PushSeedResult> {
  const maps: ClickUpMaps = { statusMap: deps.statusMap, memberMap: deps.memberMap };
  const tasks = await deps.listPmoTasks(projectId);
  let seeded = 0;
  let skipped = 0;

  for (const task of tasks) {
    const existing = await deps.resolveExternalId(task.id);
    if (existing) {
      // Idempotent: already mapped on a prior (possibly partial) run — never double-create.
      skipped += 1;
      continue;
    }
    // Mapping-set ONLY (FR-CUA-010/024/052): milestone_id / dependencies never enter the body.
    const record: PmoRecord = {
      id: task.id,
      project_id: projectId,
      name: task.name,
      status: task.status,
      assignee_id: task.assignee_id,
      start_date: task.start_date,
      end_date: task.end_date,
    };
    const body = pmoTaskToClickUpBody(record, maps, { mode: 'create' });
    const raw = (await clickUpRequest(deps, {
      method: 'POST',
      path: `/list/${deps.listId}/task`,
      body,
      priority: 'bulk',
    })) as ClickUpTask;
    await deps.recordExternalRef({
      pmoRecordId: task.id,
      externalTier: 'clickup',
      externalRecordId: raw.id,
      domain: 'tasks',
    });
    seeded += 1;
  }

  return { seeded, skipped };
}

// ──────────────────────────────────────────────────────────────────────────────
// pullAdopt (FR-CUA-060/061/062/064, AC-CUA-053)
// ──────────────────────────────────────────────────────────────────────────────

export interface PullAdoptDeps extends ClickUpBoundClientDeps {
  /** Read the org's `(tasks, clickup)` watermark cursor (`null` = fresh adopt from the beginning). */
  readWatermark: () => Promise<string | null>;
  /** Advance the watermark (monotonic — only ever forward). */
  advanceWatermark: (cursor: string) => Promise<void>;
  /** Resolve the PMO record id already mapped to a ClickUp task id (`null` = unmapped → adopt). */
  resolvePmoRecordId: (externalRecordId: string) => Promise<string | null>;
  /** Mint a new mirrored read-model row for an adopted (unmapped) ClickUp task; return its PMO id.
   *  Relies on the A8 `unique (org_id, domain, external_record_id)` to dedupe concurrent adopts. */
  mintMirror: (canonical: PmoRecord) => Promise<string>;
  /** Refresh an already-mirrored row's native fields (idempotent re-apply). */
  updateMirror: (pmoRecordId: string, canonical: PmoRecord) => Promise<void>;
  /** Record the `external_refs` mapping for a newly-minted mirror. */
  recordExternalRef: (mapping: ExternalRefSeed) => Promise<void>;
}

export interface PullAdoptResult {
  /** Newly-adopted ClickUp tasks (a fresh mirror + mapping minted) this run. */
  adopted: number;
  /** Already-mirrored ClickUp tasks refreshed (idempotent upsert) this run. */
  updated: number;
  /** The cursor the watermark was advanced to (`null` at exhaustion / not advanced). */
  nextCursor: string | null;
}

/**
 * Adopt existing ClickUp tasks into the read-model (FR-CUA-060). Enumerates the List from the
 * watermark cursor (`null` for a fresh flip), minting one mirrored `tasks` row + `external_refs`
 * mapping per ClickUp task; already-mapped tasks refresh the mirror (idempotent, FR-CUA-061), and a
 * partial run resumes from the watermark (the cursor reflects prior progress). Bulk lane
 * (NFR-CUA-PERF-003); concurrent-adopt dedupe leans on the A8 unique constraint (FR-CUA-064).
 */
export async function pullAdopt(projectId: string, deps: PullAdoptDeps): Promise<PullAdoptResult> {
  void projectId; // org/binding context is bound by the caller; pullAdopt is PMO-domain-only here.
  const cursor = await deps.readWatermark();
  const { changes, nextCursor } = await clickUpListChangesSinceWatermark('tasks', cursor, deps);

  let adopted = 0;
  let updated = 0;
  for (const canonical of changes) {
    const existingId = await deps.resolvePmoRecordId(canonical.id);
    if (existingId) {
      // Idempotent re-apply: refresh the mirror in place (no new mint, no duplicate mapping).
      await deps.updateMirror(existingId, { ...canonical, id: existingId });
      updated += 1;
    } else {
      // Pull-adopt (FR-CUA-062): mint a new mirror + mapping. A concurrent adopt that races us
      // fails the A8 unique constraint; the loser reconciles to the existing mapping on re-run.
      const pmoRecordId = await deps.mintMirror(canonical);
      await deps.recordExternalRef({
        pmoRecordId,
        externalTier: 'clickup',
        externalRecordId: canonical.id,
        domain: 'tasks',
      });
      adopted += 1;
    }
  }

  if (nextCursor !== null) {
    await deps.advanceWatermark(nextCursor);
  }

  return { adopted, updated, nextCursor };
}
