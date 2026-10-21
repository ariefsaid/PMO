import { assertEquals } from "@std/assert";
import { jsonResponse } from "../_shared/testing/edgeTestKit.ts";
import { PROJECT_ID, emptyDiscovery, graphCalls, makeScenarioRunner, newWorld, okDrives, rpcBodies } from "./recordFolderTestKit.ts";
const { handler, setTestJwks } = await import("./index.ts");
const run = makeScenarioRunner(handler, setTestJwks);
const ensure = { action: "ensure_record_folder", kind: "project", id: PROJECT_ID };

Deno.test("AC-M365DOC-070 served refresh uses the current grant for the folder capability", async () => {
  await run(newWorld({ accessExpired: true, graph: [...emptyDiscovery(), okDrives()], refresh: () => jsonResponse({
    access_token: "synthetic-new-access", refresh_token: "synthetic-new-refresh", expires_in: 3600,
    scope: "Files.Read Files.Read.All Sites.Read.All offline_access",
  }) }), async ({ call, calls, world }) => {
    const response = await call(ensure);
    assertEquals(response.status, 403);
    assertEquals((await response.json()).error, "SCOPE_INSUFFICIENT");
    const completed = rpcBodies(calls, "m365_finish_refresh");
    assertEquals(completed.length, 1);
    assertEquals((completed[0]!.p_scopes as string[]).includes("Sites.Selected"), false);
    assertEquals(completed[0]!.p_expected_refresh_token_ciphertext, world.seededRefreshCiphertext);
    assertEquals(graphCalls(calls).filter((c) => c.method === "POST").length, 0);
  });
});

Deno.test("AC-M365DOC-070 served refresh requires a usable access token and pins the credential transport", async () => {
  await run(newWorld({ accessExpired: true, refresh: (call) => {
    assertEquals(call.redirect, "error");
    return jsonResponse({ access_token: null, refresh_token: "synthetic-new-refresh", expires_in: 3600 });
  } }), async ({ call, calls }) => {
    assertEquals((await call(ensure)).status, 409);
    assertEquals(rpcBodies(calls, "m365_finish_refresh").length, 0);
    assertEquals(graphCalls(calls).length, 0);
  });
});

Deno.test("AC-M365DOC-070 served refresh reuse revocation carries the original generation", async () => {
  await run(newWorld({ accessExpired: true, refresh: () => jsonResponse({ error: "invalid_grant", error_description: "refresh token reuse detected" }, { status: 400 }) }), async ({ call, calls, world }) => {
    assertEquals((await call(ensure)).status, 409);
    const completed = rpcBodies(calls, "m365_finish_refresh");
    assertEquals(completed.length, 1);
    assertEquals(completed[0]!.p_status, "revoked");
    assertEquals(completed[0]!.p_expected_refresh_token_ciphertext, world.seededRefreshCiphertext);
  });
});

Deno.test("AC-M365DOC-070 served refresh status completion carries the original generation", async () => {
  await run(newWorld({ accessExpired: true, refresh: () => jsonResponse({ error: "invalid_grant" }, { status: 400 }) }), async ({ call, calls, world }) => {
    assertEquals((await call(ensure)).status, 409);
    const completed = rpcBodies(calls, "m365_finish_refresh");
    assertEquals(completed.length, 1);
    assertEquals(completed[0]!.p_status, "stale");
    assertEquals(completed[0]!.p_expected_refresh_token_ciphertext, world.seededRefreshCiphertext);
    assertEquals(graphCalls(calls).length, 0);
    assertEquals(rpcBodies(calls, "m365_set_connection_status").length, 0);
  });
});
