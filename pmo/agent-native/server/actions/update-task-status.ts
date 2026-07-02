import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { authRequired, dbError } from "../lib/actions-shared";
import { getCallerJwt } from "../lib/deputy-store";
import { createCallerClient } from "../lib/supabase";

const uuidShape = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const taskStatuses = ["To Do", "In Progress", "Done", "Blocked"] as const;

const updateTaskStatusSchema = z.object({
  taskId: z.string().regex(uuidShape),
  status: z.enum(taskStatuses),
});

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

    if (error) return dbError(error, "update_task_status db error");
    if (!data) {
      // RLS filtered the target to zero rows (cross-tenant or absent). Surface a
      // 42501-style denial so callers can distinguish "denied" from "not found"
      // — distinct from a driver dbError (no error object is returned here).
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
