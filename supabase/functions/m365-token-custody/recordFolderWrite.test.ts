// recordFolderWrite.test.ts — the ONE Graph write PMO performs (ADR-0089, AC-M365DOC-070). Imports the
// SHIPPED handler and the actual exported allowlist / adapter; mocks only globalThis.fetch. This file is
// the target of scripts/m365-record-folder-write-mutation.mjs: break the allowlist and it MUST go red.
import { assert, assertEquals, assertFalse } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import {
  DRIVE,
  gget,
  gpost,
  graphCalls,
  graphError,
  graphPath,
  makeScenarioRunner,
  newWorld,
  READ_SCOPES,
  FULL_SCOPES,
  SITE,
} from "./recordFolderTestKit.ts";
import { jsonResponse } from "../_shared/testing/edgeTestKit.ts";
import {
  buildFolderCreateRequest,
  folderWriteAllowed,
  type FolderWriteContext,
} from "./graphFolderWrite.ts";
import {
  openCallerRecordFolderAccess,
  scopeCoversPath,
  validateGraphProxyInput,
} from "./graphRead.ts";
import { createGraphBudget } from "./folderBudget.ts";
import type { GraphProxyRequest } from "./types.ts";

const { handler, setTestJwks } = await import("./index.ts");
const run = makeScenarioRunner(handler, setTestJwks);

const ctx: FolderWriteContext = { driveId: DRIVE, parentId: "synthetic-parent-id", name: "P-100 Synthetic project" };
const valid = () => buildFolderCreateRequest(ctx);
const clone = <T>(value: T): T => structuredClone(value);

Deno.test("AC-M365DOC-070 folder capability permits only the server-built default-drive folder POST", async (t) => {
  await t.step("the builder output is the exact folder-only POST and is the only allowed request", () => {
    const request = valid();
    assertEquals(request, {
      method: "POST",
      path: `/drives/${DRIVE}/items/synthetic-parent-id/children`,
      body: { name: ctx.name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" },
    });
    assert(folderWriteAllowed(request, ctx));
  });

  await t.step("every other request shape is refused", () => {
    const mutate = (edit: (request: ReturnType<typeof valid> & Record<string, unknown>) => void) => {
      const request = clone(valid()) as ReturnType<typeof valid> & Record<string, unknown>;
      edit(request);
      return request;
    };
    const refused: Array<[string, unknown]> = [
      ["PATCH", mutate((r) => { (r as { method: string }).method = "PATCH"; })],
      ["DELETE", mutate((r) => { (r as { method: string }).method = "DELETE"; })],
      ["PUT", mutate((r) => { (r as { method: string }).method = "PUT"; })],
      ["GET", mutate((r) => { (r as { method: string }).method = "GET"; })],
      ["lowercase post", mutate((r) => { (r as { method: string }).method = "post"; })],
      ["other drive", mutate((r) => { r.path = `/drives/other-drive/items/synthetic-parent-id/children`; })],
      ["other parent", mutate((r) => { r.path = `/drives/${DRIVE}/items/other-parent/children`; })],
      ["content path", mutate((r) => { r.path = `/drives/${DRIVE}/items/synthetic-parent-id/content`; })],
      ["path with query", mutate((r) => { r.path += "?$expand=children"; })],
      ["path with prefix", mutate((r) => { r.path = `/v1.0${r.path}`; })],
      ["me/drive", mutate((r) => { r.path = "/me/drive/root/children"; })],
      ["other name", mutate((r) => { r.body.name = "Different"; })],
      ["unsanitized name", mutate((r) => { r.body.name = "A/B"; })],
      ["file body", mutate((r) => { (r.body as Record<string, unknown>).file = {}; delete (r.body as Record<string, unknown>).folder; })],
      ["file AND folder", mutate((r) => { (r.body as Record<string, unknown>).file = {}; })],
      ["content upload field", mutate((r) => { (r.body as Record<string, unknown>)["@microsoft.graph.sourceUrl"] = "https://example.invalid/x"; })],
      ["children embedded", mutate((r) => { (r.body as Record<string, unknown>).children = [{ name: "x", folder: {} }]; })],
      ["non-empty folder facet", mutate((r) => { r.body.folder = { childCount: 3 } as never; })],
      ["folder null", mutate((r) => { r.body.folder = null as never; })],
      ["conflict rename", mutate((r) => { (r.body as Record<string, unknown>)["@microsoft.graph.conflictBehavior"] = "rename"; })],
      ["conflict replace", mutate((r) => { (r.body as Record<string, unknown>)["@microsoft.graph.conflictBehavior"] = "replace"; })],
      ["conflict missing", mutate((r) => { delete (r.body as Record<string, unknown>)["@microsoft.graph.conflictBehavior"]; })],
      ["extra request key (headers)", mutate((r) => { r.headers = { "Content-Type": "text/plain" }; })],
      ["extra request key (query)", mutate((r) => { r.query = { a: "b" }; })],
      ["missing body", mutate((r) => { delete (r as Record<string, unknown>).body; })],
      ["array body", mutate((r) => { (r as Record<string, unknown>).body = [r.body]; })],
      ["null", null],
      ["string", "POST /drives"],
    ];
    for (const [label, request] of refused) assertFalse(folderWriteAllowed(request, ctx), label);

    // Unsafe context identifiers and names never validate, even for a self-consistent request.
    for (const unsafe of ["a/b", "a\\b", "..", ".", "a%2fb", "a%2e%2e", "a b", "a\nb", "a?b", "a#b", ""]) {
      assertFalse(folderWriteAllowed(valid(), { ...ctx, parentId: unsafe }), `parent ${JSON.stringify(unsafe)}`);
      assertFalse(folderWriteAllowed(valid(), { ...ctx, driveId: unsafe }), `drive ${JSON.stringify(unsafe)}`);
      assertFalse(folderWriteAllowed(valid(), { ...ctx, name: unsafe === "a b" ? "A/B" : unsafe }), `name ${JSON.stringify(unsafe)}`);
      assert((() => { try { buildFolderCreateRequest({ ...ctx, parentId: unsafe }); return false; } catch { return true; } })(), `builder ${JSON.stringify(unsafe)}`);
    }
    assertFalse(folderWriteAllowed(valid(), { ...ctx, name: "x".repeat(121) }));
    assertFalse(folderWriteAllowed(valid(), { ...ctx, name: "trailing dot." }));
    assertFalse(folderWriteAllowed(valid(), { ...ctx, name: "ctrl\u0007name" }));
    // A request built for one context is not valid for another (drive equality is independent of the body).
    assertFalse(folderWriteAllowed(valid(), { ...ctx, driveId: "other-drive" }));
    assertFalse(folderWriteAllowed(valid(), { ...ctx, parentId: "other-parent" }));
  });

  await t.step("the browser proxy surface is GET-only and body-less, regardless of held write scopes", () => {
    const base = { action: "graph_proxy", path: "/me/drive/root/children" } as const;
    for (const method of ["POST", "PATCH", "PUT", "DELETE"] as const) {
      const rejected = validateGraphProxyInput({ ...base, method } as GraphProxyRequest);
      assertEquals(rejected?.status, 400, method);
    }
    assertEquals(validateGraphProxyInput({ ...base, method: "GET", body: { name: "x" } }) ?.status, 400);
    assertEquals(validateGraphProxyInput({ ...base, method: "GET" }), null);
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      assertFalse(scopeCoversPath(["Files.ReadWrite", "Files.ReadWrite.All", "Sites.Selected"], method, "/drives/x/items/y/children"), method);
    }
    assert(scopeCoversPath(["Files.Read"], "GET", "/drives/x/items/y"));
  });

  await t.step("served browser graph_proxy writes are refused with ZERO Microsoft calls, even on a legacy write-scope connection", async () => {
    const legacy = newWorld({ scopes: ["Files.ReadWrite", "Files.ReadWrite.All", "Sites.Selected", "offline_access"] });
    const cases: Array<Record<string, unknown>> = [
      { method: "POST", path: "/me/drive/root/children", body: { name: "x", folder: {} } },
      { method: "POST", path: `/drives/${DRIVE}/items/synthetic-parent-id/children`, body: { name: "x", folder: {}, "@microsoft.graph.conflictBehavior": "fail" } },
      { method: "POST", path: "/drives/other-drive/items/p/children", body: { name: "x", folder: {} } },
      { method: "PUT", path: "/me/drive/root:/a.txt:/content", body: "data" },
      { method: "POST", path: "/me/drive/root/children", body: { name: "a.txt", file: {} } },
      { method: "PATCH", path: "/drives/d/items/i", body: { name: "renamed" } },
      { method: "DELETE", path: "/drives/d/items/i" },
      { method: "GET", path: "/drives/d/items/i", body: { sneaky: true } },
    ];
    for (const proxy of cases) {
      await run(legacy, async ({ call, calls }) => {
        const response = await call({ action: "graph_proxy", ...proxy });
        assertEquals(response.status, 400, JSON.stringify(proxy));
        assertEquals((await response.json()).error, "BAD_REQUEST");
        assertEquals(graphCalls(calls).length, 0, JSON.stringify(proxy));
        assertEquals(calls.filter((c) => c.url.host === "login.microsoftonline.com").length, 0);
      });
    }
    // The proxy still serves reads (the contract change only strengthened refusal).
    await run(newWorld({ graph: [gget("/me/drive", () => jsonResponse({ id: "d" }))] }), async ({ call }) => {
      const response = await call({ action: "graph_proxy", method: "GET", path: "/me/drive" });
      assertEquals(response.status, 200);
    });
  });
});

Deno.test("AC-M365DOC-070 the narrow folder adapter builds its own request, classifies only precise absence and conflict, and leaks nothing", async (t) => {
  const open = async (deps: Parameters<typeof openCallerRecordFolderAccess>[0], budget = createGraphBudget()) => {
    const access = await openCallerRecordFolderAccess(deps, { site_id: SITE, drive_id: DRIVE }, "ensure", budget);
    assert("createFolder" in access, "ensure access must expose the folder mutator");
    return access;
  };
  const item = (id = "new-id") => ({ id, name: ctx.name, webUrl: `https://example.invalid/${id}`, folder: {}, parentReference: { driveId: DRIVE, id: ctx.parentId } });
  const createPath = `/drives/${DRIVE}/items/${ctx.parentId}/children`;

  await t.step("201 => ok; the captured POST is the exact server-built request with the bearer header only on the wire", async () => {
    await run(newWorld({ graph: [gpost(createPath, () => jsonResponse(item(), { status: 201 }))] }), async ({ deps, calls }) => {
      const access = await open(deps);
      const outcome = await access.createFolder(ctx.parentId, ctx.name);
      assertEquals(outcome.kind, "ok");
      const [post] = graphCalls(calls);
      assertEquals(post!.method, "POST");
      assertEquals(graphPath(post!), createPath);
      assertEquals(post!.url.search, "");
      assertEquals(post!.bodyJson, { name: ctx.name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" });
      assertEquals(post!.headers.get("authorization"), "Bearer synthetic-access-token");
      assertFalse(JSON.stringify(outcome).includes("synthetic-access-token"));
    });
  });

  await t.step("unsafe parent / unsanitized name never reach the network", async () => {
    await run(newWorld(), async ({ deps, calls }) => {
      const access = await open(deps);
      for (const [parent, name] of [["a/b", ctx.name], ["..", ctx.name], [ctx.parentId, "A/B"], [ctx.parentId, ""], [ctx.parentId, "x".repeat(121)]]) {
        assertEquals((await access.createFolder(parent!, name!)).kind, "unavailable", `${parent}|${name}`);
      }
      assertEquals(graphCalls(calls).length, 0);
    });
  });

  await t.step("status classification is closed: 409 nameAlreadyExists, 403, everything else unavailable", async () => {
    const table: Array<[string, () => Response, string]> = [
      ["409 nameAlreadyExists", () => graphError(409, "nameAlreadyExists"), "name_conflict"],
      ["409 other", () => graphError(409, "resourceLocked"), "unavailable"],
      ["403", () => graphError(403, "accessDenied"), "forbidden"],
      ["404 itemNotFound on create", () => graphError(404, "itemNotFound"), "not_found"],
      ["429", () => graphError(429, "activityLimitReached"), "unavailable"],
      ["503", () => graphError(503, "serviceNotAvailable"), "unavailable"],
      ["200 instead of 201", () => jsonResponse(item(), { status: 200 }), "unavailable"],
      ["201 non-JSON", () => new Response("<html>", { status: 201 }), "unavailable"],
      ["201 JSON array", () => jsonResponse([item()], { status: 201 }), "unavailable"],
    ];
    for (const [label, respond, expected] of table) {
      await run(newWorld({ graph: [gpost(createPath, respond)] }), async ({ deps, calls }) => {
        const access = await open(deps);
        const outcome = await access.createFolder(ctx.parentId, ctx.name);
        assertEquals(outcome.kind, expected, label);
        assertEquals(graphCalls(calls).length, 1, `${label}: no retry`);
      });
    }
  });

  await t.step("metadata reads: only 404 itemNotFound is absence; everything else is a failure", async () => {
    const childPath = `/drives/${DRIVE}/items/${ctx.parentId}:/Projects`;
    const target = { kind: "child", parentId: ctx.parentId, name: "Projects" } as const;
    const table: Array<[string, () => Response, string]> = [
      ["404 itemNotFound", () => graphError(404, "itemNotFound"), "not_found"],
      ["404 other code", () => graphError(404, "drive_not_found"), "unavailable"],
      ["403", () => graphError(403, "accessDenied"), "forbidden"],
      ["429", () => graphError(429, "activityLimitReached"), "unavailable"],
      ["non-JSON 200", () => new Response("nope", { status: 200 }), "unavailable"],
      ["200 ok", () => jsonResponse(item("existing")), "ok"],
    ];
    for (const [label, respond, expected] of table) {
      await run(newWorld({ graph: [gget(childPath, respond)] }), async ({ deps }) => {
        const access = await open(deps);
        assertEquals((await access.readFolder(target)).kind, expected, label);
      });
    }
  });

  await t.step("a hung create is aborted at the per-call deadline and is a failure, not absence", async () => {
    const time = new FakeTime();
    try {
      await run(newWorld({ graph: [gpost(createPath, (call) => new Promise<Response>((_r, reject) => call.signal.addEventListener("abort", () => reject(new Error("aborted")))))] }), async ({ deps }) => {
        const access = await open(deps);
        let settled = false;
        const pending = access.createFolder(ctx.parentId, ctx.name).finally(() => (settled = true));
        for (let i = 0; i < 40 && !settled; i += 1) await time.tickAsync(250);
        assertEquals((await pending).kind, "unavailable");
      });
    } finally {
      time.restore();
    }
  });

  await t.step("failure logs carry no token, URL, name or path", async () => {
    const original = console.error;
    const logged: string[] = [];
    console.error = (...args: unknown[]) => { logged.push(JSON.stringify(args)); };
    try {
      await run(newWorld({ graph: [gpost(createPath, () => graphError(503, "serviceNotAvailable")), gget(/^\/drives\/synthetic-drive\/root\/search/, () => graphError(503, "serviceNotAvailable"))] }), async ({ deps }) => {
        const access = await open(deps);
        await access.createFolder(ctx.parentId, ctx.name);
        await access.get({ path: `/drives/${DRIVE}/root/search(q='P-100')`, query: { "$top": "100" } });
      });
    } finally {
      console.error = original;
    }
    assert(logged.length > 0);
    for (const line of logged) {
      for (const secret of ["synthetic-access-token", "P-100", ctx.name, ctx.parentId, "synthetic upstream text", "graph.microsoft.com"]) {
        assertFalse(line.includes(secret), `${secret} leaked into: ${line}`);
      }
    }
  });
});

Deno.test("AC-M365DOC-070 capability by mode: match_only has no mutator and needs only read consent; ensure needs Sites.Selected before any refresh", async () => {
  await run(newWorld({ scopes: READ_SCOPES }), async ({ deps, calls }) => {
    const read = await openCallerRecordFolderAccess(deps, { site_id: SITE, drive_id: DRIVE }, "match_only", createGraphBudget());
    assert("get" in read);
    assertFalse("createFolder" in read);
    assertFalse("readFolder" in read);
    const ensure = await openCallerRecordFolderAccess(deps, { site_id: SITE, drive_id: DRIVE }, "ensure", createGraphBudget());
    assert("status" in ensure && ensure.status === 403);
    assertEquals((ensure.body as { error: string }).error, "SCOPE_INSUFFICIENT");
    assertEquals(calls.filter((c) => c.url.host === "login.microsoftonline.com" || c.url.host === "graph.microsoft.com").length, 0);
  });
  await run(newWorld({ scopes: FULL_SCOPES }), async ({ deps }) => {
    const ensure = await openCallerRecordFolderAccess(deps, { site_id: SITE, drive_id: DRIVE }, "ensure", createGraphBudget());
    assert("createFolder" in ensure);
    // No credential getter or generic authenticated request is exposed.
    assertEquals(Object.keys(ensure).sort(), ["createFolder", "get", "readFolder"]);
  });
});
