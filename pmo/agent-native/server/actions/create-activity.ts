import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { getCallerJwt } from "../lib/deputy-store";
import { createCallerClient } from "../lib/supabase";

const uuidShape = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const activityKindMap = {
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  note: "Note",
} as const;

type SupabaseError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

const createActivitySchema = z.object({
  contactId: z.string().regex(uuidShape),
  kind: z.enum(["call", "email", "meeting", "note"]),
  subject: z.string().min(1).max(200),
  body: z.string().max(2000).optional(),
  occurredAt: z.string().optional(),
});

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
      message: error?.message ?? "create_activity db error",
      details: error?.details,
      hint: error?.hint,
    },
  };
}

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
    const { data, error } = await caller
      .from("crm_activities")
      .insert({
        contact_id: args.contactId,
        kind: activityKindMap[args.kind],
        subject: args.subject,
        body: args.body ?? null,
        occurred_at: args.occurredAt ?? new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) return dbError(error);

    return { id: String(data.id) };
  },
});
