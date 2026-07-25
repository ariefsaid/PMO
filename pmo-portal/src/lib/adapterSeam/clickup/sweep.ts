/**
 * The reconciliation sweep (FR-CUA-045/046/047, AC-CUA-043/044). The safety net that catches webhook
 * gaps (ADR-0055 §3: webhooks for latency, sweep for truth): per employing org, read the
 * `(tasks, clickup)` watermark → enumerate changes since it → apply each through the SAME
 * source-mod-guarded path as the webhook (FR-CUA-049 "any apply", via the shared `applyInboundChange`)
 * → advance the watermark to `nextCursor` (monotonic, never rewinds).
 *
 * Pure + Deno-importable (relative imports only); all DB + ClickUp access is via injected deps, so
 * every path is unit-testable with mocked callbacks (no live token). Bulk lane throughout
 * (NFR-CUA-PERF-003). ClickUp vocabulary is confined to clickup/** + the clickup-sweep fn (FR-CUA-012).
 */
import type { ClickUpMaps } from './mapping.ts';
import type { ClickUpStatusMap } from './statusMap.ts';
import type { ClickUpMemberMap } from './memberMap.ts';
import {
  runSweep as runSweepGeneric,
  type ApplyChangeDeps,
  type WatermarkDeps,
  type SweepChange,
  type SweepListChangesDeps,
  type SweepResult,
} from '../applyEngine.ts';

const CLICKUP_TIER = 'clickup';
const TASKS_DOMAIN = 'tasks';
const CLICKUP_TASKS_CTX = { tier: CLICKUP_TIER, domain: TASKS_DOMAIN };

// Re-exported for byte-for-byte back-compat (task 1.12 hoists the implementation to
// `../applyEngine.ts`; `SweepChange`/`SweepResult` keep their pre-1.12 shape + import path).
export type { SweepChange, SweepResult };

export interface SweepDeps extends ApplyChangeDeps, WatermarkDeps, SweepListChangesDeps, ClickUpMaps {
  statusMap: ClickUpStatusMap;
  memberMap: ClickUpMemberMap;
}

/**
 * Run one sweep cycle for an employing org (AC-CUA-043/044). Reads the watermark, enumerates changes
 * since it, applies each through the source-mod-guarded path, and advances the watermark to
 * `nextCursor` (monotonic). If the adapter is unreachable (`listChanges` throws), the sweep throws
 * WITHOUT advancing the watermark or touching the read-model (AC-CUA-044) — the next schedule retries.
 *
 * Task 1.12: delegates to the hoisted, tier/domain-parameterized `applyEngine.ts` with
 * `{tier:'clickup',domain:'tasks'}` baked in — byte-for-byte identical behavior + signature to the
 * pre-1.12 ClickUp-only implementation (`runSweep(deps)`, single argument).
 */
export async function runSweep(deps: SweepDeps): Promise<SweepResult> {
  return runSweepGeneric(CLICKUP_TASKS_CTX, deps);
}
