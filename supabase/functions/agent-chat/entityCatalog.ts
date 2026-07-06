/**
 * entityCatalog.ts — the agent read-tool's single entity-resolution seam (Defect 2).
 *
 * Resolves an `AGENT_READ_ENTITIES` key to its normalized entry `{ table, allowedColumns,
 * requiredFilter? }`, drawing from TWO sources so neither the model nor the read path has to know
 * which source a given entity lives in:
 *   1. `AGENT_ENTITY_TABLES` (readEntities.ts, agent-curated, dependency-free leaf) — procurements,
 *      milestones, timesheets.
 *   2. `ENTITY_WHITELIST` (pmo-portal/src/lib/viewspec/types.ts, the compose-view audited catalogue)
 *      — projects, companies, tasks, incidents, contacts. ENTITY_WHITELIST stays the single source
 *      of truth for those (its column sets are audited against database.types.ts).
 *
 * Consumed by actions.ts (runQueryEntity — the runtime whitelist/column gate) and prompt.ts (the
 * schema-metadata entity descriptions). This module MAY import ENTITY_WHITELIST (it is not part of
 * the actions↔schema cycle — readEntities.ts is the leaf that breaks that cycle); readEntities.ts
 * itself stays dependency-free.
 *
 * SECURITY (NFR-AR-SEC-003/004): `allowedColumns` is the column-whitelist authority — only those
 * columns may be SELECTed or FILTERed on. `org_id` never appears in any entry, so the tenancy seam
 * is never surfaced to the model. RLS (under the caller JWT) remains the row-level enforcement
 * authority; this catalogue adds no privilege.
 */

// Relative imports — no .ts extension; no @-alias (Deno has no Vite alias).
import { ENTITY_WHITELIST } from '../../../pmo-portal/src/lib/viewspec/types.ts';
import { AGENT_ENTITY_TABLES } from './readEntities.ts';

/** Normalized entry the read path + prompt both consume. */
export interface AgentEntityEntry {
  /** Real Postgres table the caller-JWT client reads from. */
  table: string;
  /** The only columns a query may SELECT or FILTER on (org_id never included). */
  allowedColumns: ReadonlySet<string>;
  /** When set, a filter on this column (eq or in) is mandatory (e.g. tasks.project_id). */
  requiredFilter?: string;
}

/**
 * Resolve an agent entity key to its normalized entry, or `undefined` when the key is not in the
 * agent catalogue (the caller treats undefined as "unknown entity" → structured error, no DB read).
 *
 * Resolution order is cosmetic (an entity key is in exactly one source), but AGENT_ENTITY_TABLES is
 * checked first so the agent-curated entries are self-contained and never accidentally shadowed by a
 * same-named ENTITY_WHITELIST key.
 */
export function resolveAgentEntity(entityKey: string): AgentEntityEntry | undefined {
  const curated = AGENT_ENTITY_TABLES[entityKey];
  if (curated) {
    return {
      table: curated.table,
      allowedColumns: new Set(curated.allowedColumns),
    };
  }

  const whitelisted = ENTITY_WHITELIST[entityKey as keyof typeof ENTITY_WHITELIST];
  if (whitelisted) {
    return {
      table: whitelisted.table,
      allowedColumns: whitelisted.allowedColumns,
      ...(whitelisted.requiredFilter ? { requiredFilter: whitelisted.requiredFilter } : {}),
    };
  }

  return undefined;
}
