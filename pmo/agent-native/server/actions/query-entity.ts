import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { authRequired, badRequest, dbError } from "../lib/actions-shared";
import {
  AGENT_READ_ENTITIES,
  AGENT_READ_ROW_CAP,
  READ_ALLOWED,
  READ_ENTITY_MAP,
  type AgentReadEntity,
} from "../lib/read-allowlist";
import { getCallerJwt } from "../lib/deputy-store";
import { createCallerClient } from "../lib/supabase";

// Re-exported so the gate test can import the row cap + entity list from the
// action module surface it already targets.
export { AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP };

const queryEntitySchema = z.object({
  entity: z.string(),
  columns: z.array(z.string()).optional(),
  filter: z
    .object({
      column: z.string(),
      op: z.enum(["eq", "in"]),
      value: z.unknown(),
    })
    .optional(),
  limit: z.number().int().positive().optional(),
});

export const queryEntityAction = defineAction({
  description:
    "Read allow-listed PMO entities (projects, companies) as the caller through the deputy client. " +
    "RLS scopes rows; entities outside the read allow-list, and unknown columns, are rejected before any business read.",
  schema: queryEntitySchema,
  agentTool: true,
  readOnly: true,
  run: async (args) => {
    // I-1: runtime read allow-list. The documented agent READ surface is
    // projects + companies ONLY — enforce it before resolving the (wider)
    // viewspec-style column map, so contacts (PII) / tasks / incidents /
    // user_views are unreadable through this action even though they exist in
    // PMO's viewspec whitelist. Least-privilege by default.
    if (!READ_ALLOWED.has(args.entity)) {
      return badRequest(`read not permitted for entity: ${args.entity}`);
    }

    const entity = args.entity as AgentReadEntity;
    const entry = READ_ENTITY_MAP[entity];

    const requestedColumns = args.columns ?? [...entry.allowedColumns];
    for (const column of requestedColumns) {
      if (!entry.allowedColumns.has(column)) {
        return badRequest(`unknown column: ${column} on entity ${entity}`);
      }
    }

    if (args.filter && !entry.allowedColumns.has(args.filter.column)) {
      return badRequest(`unknown filter column: ${args.filter.column} on entity ${entity}`);
    }

    const jwt = getCallerJwt();
    if (!jwt) return authRequired();

    const caller = createCallerClient(jwt);
    const limit = Math.min(args.limit ?? AGENT_READ_ROW_CAP, AGENT_READ_ROW_CAP);
    const select = requestedColumns.join(",");
    let builder = caller.from(entry.table).select(select) as any;

    if (args.filter) {
      if (args.filter.op === "eq") {
        builder = builder.eq(args.filter.column, String(args.filter.value));
      } else {
        const values = Array.isArray(args.filter.value)
          ? args.filter.value.map((value) => String(value))
          : [String(args.filter.value)];
        builder = builder.in(args.filter.column, values);
      }
    }

    const { data, error } = await builder.limit(limit);
    if (error) return dbError(error, "query_entity db error");

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    return {
      rowCount: rows.length,
      rows,
    };
  },
});
