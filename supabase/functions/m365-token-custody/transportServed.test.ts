import { assertEquals, assertFalse } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { jsonResponse } from "../_shared/testing/edgeTestKit.ts";
import {
  DRIVE, PROJECT_ID, gget, graphCalls, makeScenarioRunner, newWorld, rpcBodies,
} from "./recordFolderTestKit.ts";
import { openCallerGraphRead } from "./graphRead.ts";

const { handler, setTestJwks } = await import("./index.ts");
const run = makeScenarioRunner(handler, setTestJwks);
const proxy = (path: string, query?: Record<string, string>) => ({ action: "graph_proxy", method: "GET", path, ...(query ? { query } : {}) });

Deno.test("AC-M365DOC-070 served metadata transport keeps redirects local", async () => {
  await run(newWorld({ graph: [gget(`/drives/${DRIVE}/root`, (call) => {
    assertEquals(call.redirect, "error");
    return jsonResponse({ id: "root", folder: {} });
  })] }), async ({ call }) => {
    assertEquals((await call(proxy(`/drives/${DRIVE}/root`))).status, 200);
  });
});

Deno.test("AC-M365DOC-070 served browser reads stay on the metadata surface", async () => {
  for (const path of [
    `/drives/${DRIVE}/items/item/content`, `/drives/${DRIVE}/items/item/preview`,
    `/drives/${DRIVE}/items/item/permissions`, `/sites/site/permissions`,
    `/drives/${DRIVE}/root/search(q='a')/items/X/permissions(x)`,
    `/drives/${DRIVE}/root/search(q='a')/D2/content)`,
  ]) {
    await run(newWorld(), async ({ call, calls }) => {
      const response = await call(proxy(path));
      assertEquals(response.status, 403);
      assertEquals(graphCalls(calls).length, 0);
    });
  }
});

Deno.test("AC-M365DOC-070 served metadata responses contain reference fields only", async () => {
  await run(newWorld({ graph: [gget(`/drives/${DRIVE}/root/children`, () => jsonResponse({
    value: [{ id: "item", name: "Synthetic", folder: {}, webUrl: "https://example.invalid/item",
      parentReference: { driveId: DRIVE }, "@microsoft.graph.downloadUrl": "https://example.invalid/capability",
      "@content.downloadUrl": "https://example.invalid/legacy-capability" }],
  }))] }), async ({ call }) => {
    const response = await call(proxy(`/drives/${DRIVE}/root/children`));
    assertEquals(response.status, 200);
    const body = JSON.stringify(await response.json());
    assertFalse(body.includes("capability"));
    assertFalse(body.includes("legacy-capability"));
  });
});

Deno.test("AC-M365DOC-070 served proxy re-checks Files scope after refresh", async () => {
  await run(newWorld({
    accessExpired: true,
    refresh: () => jsonResponse({ access_token: "synthetic-new-access", refresh_token: "synthetic-new-refresh", expires_in: 3600, scope: "Sites.Read.All offline_access" }),
    graph: [],
  }), async ({ call, calls }) => {
    const response = await call(proxy(`/drives/${DRIVE}/root`));
    assertEquals(response.status, 403);
    assertEquals(graphCalls(calls).length, 0);
  });
});

Deno.test("AC-M365DOC-070 served batch re-checks Files scope after refresh", async () => {
  await run(newWorld({
    accessExpired: true,
    refresh: () => jsonResponse({ access_token: "synthetic-new-access", refresh_token: "synthetic-new-refresh", expires_in: 3600, scope: "Sites.Read.All offline_access" }),
    graph: [],
  }), async ({ deps, calls }) => {
    const session = await openCallerGraphRead(deps);
    if (!("batch" in session)) throw new Error("expected an opened Graph session");
    const response = await session.batch([{
      id: "1", method: "GET",
      url: `/drives/${DRIVE}/items/item?$select=id,name,webUrl,parentReference,file,folder,cTag,sharepointIds`,
    }]);
    assertEquals(response.status, 403);
    assertEquals(graphCalls(calls).length, 0);
  });
});

Deno.test("AC-M365DOC-070 metadata projection drops unlisted upstream fields", async () => {
  await run(newWorld({ graph: [gget(`/drives/${DRIVE}/root`, () => jsonResponse({
    id: "root", folder: {}, unlistedSensitive: "synthetic-unlisted-value",
  }))] }), async ({ call }) => {
    const response = await call(proxy(`/drives/${DRIVE}/root`));
    assertEquals(response.status, 200);
    assertEquals(JSON.stringify(await response.json()).includes("unlistedSensitive"), false);
  });
});

Deno.test("AC-M365DOC-071 served ensure accounts for metadata body time", async () => {
  const time = new FakeTime();
  let canceled = false;
  try {
    await run(newWorld({ graph: [gget(`/drives/${DRIVE}/root`, () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"id":')); },
      cancel() { canceled = true; },
    }), { headers: { "content-type": "application/json" } }))] }), async ({ call, calls }) => {
      let response: Response | undefined;
      const pending = call({ action: "ensure_record_folder", kind: "project", id: PROJECT_ID }).then((r) => { response = r; });
      for (let i = 0; i < 200 && !response; i += 1) await time.tickAsync(100);
      assertEquals(response?.status, 502);
      await pending;
      assertEquals(canceled, true);
      assertEquals(rpcBodies(calls, "m365_link_record_folder").length, 0);
    });
  } finally { time.restore(); }
});

Deno.test("AC-M365DOC-071 served ensure bounds a pending record read", async () => {
  const time = new FakeTime();
  let aborted = false;
  try {
    await run(newWorld({ parent: (call) => new Promise((_resolve, reject) => {
      call.signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); });
    }) }), async ({ call, calls }) => {
      let response: Response | undefined;
      const pending = call({ action: "ensure_record_folder", kind: "project", id: PROJECT_ID }).then((r) => { response = r; });
      for (let i = 0; i < 160 && !response; i += 1) await time.tickAsync(100);
      assertEquals(response?.status, 502);
      assertEquals(aborted, true);
      await pending;
      assertEquals(graphCalls(calls).length, 0);
      assertEquals(rpcBodies(calls, "m365_link_record_folder").length, 0);
    });
  } finally { time.restore(); }
});

Deno.test("AC-M365DOC-070 served browser metadata calls use a caller quota", async () => {
  await run(newWorld({ rate: () => jsonResponse(false) }), async ({ call, calls }) => {
    assertEquals((await call(proxy(`/drives/${DRIVE}/root`))).status, 429);
    assertEquals(graphCalls(calls).length, 0);
  });
});
