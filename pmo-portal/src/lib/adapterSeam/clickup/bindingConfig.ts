/**
 * Per-project binding config helpers (FR-CUA-011/013, review fix #3/#9). The `external_project_bindings`
 * row carries a `config jsonb` of `{ statusMap, memberMap }`; this is the single home for reading those
 * maps with the empty-map fallback — shared by the four ClickUp edge fns (via `_shared/clickupMirrorDeps`)
 * and the pure dispatch factory (`dispatchFactory.ts`). Pure + portable (Vitest + Deno).
 */
import type { ClickUpStatusMap } from './statusMap.ts';
import type { ClickUpMemberMap } from './memberMap.ts';

const DEFAULT_STATUS_MAP: ClickUpStatusMap = { pmoToClickUp: {}, clickUpToPmo: {}, defaultPmoStatus: 'To Do' };
const DEFAULT_MEMBER_MAP: ClickUpMemberMap = { pmoToClickUp: {}, clickUpToPmo: {} };

export interface BindingMaps {
  statusMap: ClickUpStatusMap;
  memberMap: ClickUpMemberMap;
}

/**
 * Read status/member maps off a binding config jsonb, falling back to empty maps when either is absent.
 * Domain-generic — no ClickUp status/member vocabulary enters here (FR-CUA-012).
 */
export function mapsFromBindingConfig(config: unknown): BindingMaps {
  const cfg = (config ?? {}) as { statusMap?: ClickUpStatusMap; memberMap?: ClickUpMemberMap };
  return {
    statusMap: cfg.statusMap ?? DEFAULT_STATUS_MAP,
    memberMap: cfg.memberMap ?? DEFAULT_MEMBER_MAP,
  };
}
