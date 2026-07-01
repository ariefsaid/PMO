import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { getCallerJwt } from "../lib/deputy-store";
import { createCallerClient } from "../lib/supabase";

const uuidShape = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const taskStatuses = ["To Do", "In Progress", "Done", "Blocked"] as const;

type SupabaseError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

const updateTaskStatusSchema = z.object({
  taskId: z.string().regex(uuidShape),
  status: z.enum(taskStatuses),
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
      message: error?.message ?? "update_task_status db error",
      details: error?.details,
      hint: error?.hint,
    },
  };
}

export const updateTaskStatusAction = defineAction({
  description:
    "Update a PMO task status as the caller through the deputy client. " +
    "RLS determines whether the caller may mutate the target task.",
  schema: updateTaskStatusSchema,
  agentTool: true,
  run: async (args) => {
    const jwt = getCallerJwt();
    if (!jwt) return authRequired();

    const caller = createCallerClient(jwt);
    const { data, error } = await caller
      .from("tasks")
      .update({ status: args.status })
      .eq("id", args.taskId)
      .select("id,status")
      .maybeSingle();

    if (error) return dbError(error);
    if (!data) {
      return {
        error: {
          code: "42501",
          message: "update_task_status denied by RLS",
        },
      };
    }

    return {
      taskId: String(data.id),
      status: String(data.status),
    };
  },
});
