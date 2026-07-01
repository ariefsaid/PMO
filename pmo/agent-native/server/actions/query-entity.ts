import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { ENTITY_WHITELIST } from "../../../../pmo-portal/src/lib/viewspec/types";
import { getCallerJwt } from "../lib/deputy-store";
import { createCallerClient } from "../lib/supabase";

export const AGENT_READ_ENTITIES = ["projects", "companies"] as const;
export const AGENT_READ_ROW_CAP = 50;

type AgentReadEntity = (typeof AGENT_READ_ENTITIES)[number];

type SupabaseError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

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

function badRequest(message: string) {
  return { error: { code: "BAD_REQUEST", message } };
}

function authRequired() {
  return {
    error: {
      code: "NO_CALLER_IDENTITY",
      message: "No authenticated caller on this request (missing caller JWT).",
    },
  };
}

function dbError(error: SupabaseError | null) {
  return {
    error: {
      code: error?.code,
      message: error?.message ?? "query_entity db error",
      details: error?.details,
      hint: error?.hint,
    },
  };
}

export const queryEntityAction = defineAction({
  description:
    "Read whitelisted PMO entities as the caller through the deputy client. " +
    "RLS scopes rows; unknown entities and columns are rejected before any business read.",
  schema: queryEntitySchema,
  agentTool: true,
  readOnly: true,
  run: async (args) => {
    const entity = args.entity as AgentReadEntity;
    const entry = ENTITY_WHITELIST[entity];
    if (!entry) {
      return badRequest(`unknown entity: ${args.entity}`);
    }

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
    if (error) return dbError(error);

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    return {
      rowCount: rows.length,
      rows,
    };
  },
});
