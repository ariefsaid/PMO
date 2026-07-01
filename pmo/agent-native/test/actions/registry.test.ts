import { describe, expect, it } from "vitest";

const SIDECAR_URL = process.env.SIDECAR_URL ?? "http://127.0.0.1:8100";
const ACTIONS = ["pmo_query", "query_entity", "create_activity", "update_task_status"] as const;

describe("AC-406 action registry", () => {
  it("AC-406 mounts the PMO action endpoints in the embedded plugin", async () => {
    for (const actionName of ACTIONS) {
      const res = await fetch(`${SIDECAR_URL}/_agent-native/actions/${actionName}`, {
        method: "GET",
      });

      expect(res.status, `${actionName} should be mounted (not 404)`).not.toBe(404);
    }
  });
});
