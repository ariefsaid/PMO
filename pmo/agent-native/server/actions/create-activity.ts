import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { ACTIVITY_KIND_FROM_ALIAS, authRequired, dbError } from "../lib/actions-shared";
import { getCallerJwt } from "../lib/deputy-store";
import { createCallerClient } from "../lib/supabase";

const uuidShape = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const createActivitySchema = z.object({
  contactId: z.string().regex(uuidShape),
  kind: z.enum(Object.keys(ACTIVITY_KIND_FROM_ALIAS) as [string, ...string[]]),
  subject: z.string().min(1).max(200),
  body: z.string().max(2000).optional(),
  occurredAt: z.string().optional(),
});

export const createActivityAction = defineAction({
  description:
    "Create a CRM activity as the caller through the deputy client. " +
    "org_id is stamped by PMO and RLS remains the enforcement ceiling.",
  schema: createActivitySchema,
  agentTool: true,
  run: async (args) => {
    const jwt = getCallerJwt();
    if (!jwt) return authRequired();

    const caller = createCallerClient(jwt);
    // M-4: prefer the DB default for occurred_at (now()) — only send it when the
    // caller explicitly back-dates. Matches pmo_query.create_activity, which
    // also omits occurred_at and relies on the column default. Server/DB is the
    // timestamp authority.
    const { data, error } = await caller
      .from("crm_activities")
      .insert({
        contact_id: args.contactId,
        kind: ACTIVITY_KIND_FROM_ALIAS[args.kind],
        subject: args.subject,
        body: args.body ?? null,
        ...(args.occurredAt ? { occurred_at: args.occurredAt } : {}),
      })
      .select("id")
      .single();

    if (error) return dbError(error, "create_activity db error");

    return { id: String(data.id) };
  },
});
