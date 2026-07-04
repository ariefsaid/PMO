/**
 * readEntities.ts — the agent read-tool whitelist + row cap (D5/D6). A dependency-free LEAF module.
 *
 * These live here, not in actions.ts, to break a circular import: schema.ts builds QUERY_ENTITY_SCHEMA
 * from AGENT_READ_ENTITIES at module scope, and actions.ts imports the schema objects from schema.ts —
 * so actions.ts ↔ schema.ts is a cycle. When the deployed edge worker bundled + evaluated schema.ts
 * before actions.ts finished initializing, `AGENT_READ_ENTITIES` was read in its temporal dead zone and
 * the worker crashed at boot (WORKER_ERROR, prod deploy 2026-07-04). A leaf module (no imports) can
 * never participate in a cycle, so it is always initialized first. Keep this file dependency-free.
 */

/** Whitelisted entities available to the agent in A1 (D5/R3). */
export const AGENT_READ_ENTITIES = ['projects', 'companies'] as const;
export type AgentReadEntity = (typeof AGENT_READ_ENTITIES)[number];

/** Hard row cap — the effective limit is min(input.limit ?? CAP, CAP). D6. */
export const AGENT_READ_ROW_CAP = 50;
