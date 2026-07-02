/**
 * Sidecar-local read allow-list (M-2) — the SMALL entity/column surface the
 * agent-native sidecar is permitted to read, plus the read-row cap.
 *
 * WHY THIS EXISTS: `query-entity.ts` used to import the FULL 6-entity
 * `ENTITY_WHITELIST` from `../../../../pmo-portal/src/lib/viewspec/types` — a
 * fragile cross-package boundary that also made the agent's READ surface larger
 * than intended. The agent's documented read surface is ONLY `projects` +
 * `companies` (the others — contacts (PII), tasks, incidents, user_views — are
 * not exposed to reads). This module copies JUST the two entities the sidecar
 * needs, and a parity contract test
 * (test/actions/read-allowlist.contract.test.ts) asserts these column sets
 * match PMO's `ENTITY_WHITELIST` for those two entities, so schema drift fails
 * CI rather than silently diverging.
 *
 * I-1: the `AGENT_READ_ENTITIES` set is the runtime allow-list —
 * `query-entity.ts` rejects any entity NOT in this set BEFORE resolving columns,
 * so a caller asking for `contacts` / `tasks` / `user_views` is refused
 * regardless of the wider viewspec whitelist. Least-privilege by default.
 */

/** Entities the agent MAY read. Keep this narrow; widening is a deliberate decision. */
export const AGENT_READ_ENTITIES = ["projects", "companies"] as const;
export type AgentReadEntity = (typeof AGENT_READ_ENTITIES)[number];

/** Runtime allow-list (I-1 guard). Frozen so it cannot be widened at runtime. */
export const READ_ALLOWED: ReadonlySet<string> = new Set<string>(AGENT_READ_ENTITIES);

export interface ReadEntityEntry {
  /** Postgres table name. */
  table: string;
  /** All column names permitted in select/filter for this entity. */
  allowedColumns: ReadonlySet<string>;
}

/**
 * The read surface — table + allowed columns per entity. Column sets are copied
 * verbatim from PMO's `ENTITY_WHITELIST` (projects + companies); the contract
 * test pins the parity. NOTE: intentionally NOT the full viewspec entry — the
 * agent read path does not need numeric/date/groupable classification.
 */
export const READ_ENTITY_MAP: Readonly<Record<AgentReadEntity, ReadEntityEntry>> = Object.freeze({
  projects: {
    table: "projects",
    allowedColumns: new Set<string>([
      "id",
      "name",
      "status",
      "start_date",
      "end_date",
      "contract_value",
      "created_at",
      "client_id",
      "project_manager_id",
      "code",
      "budget",
      "spent",
    ]),
  },
  companies: {
    table: "companies",
    allowedColumns: new Set<string>(["id", "name", "type", "created_at"]),
  },
});

/** Maximum rows a single agent read may return. */
export const AGENT_READ_ROW_CAP = 50;
