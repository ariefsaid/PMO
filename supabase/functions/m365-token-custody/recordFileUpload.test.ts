// recordFileUpload.test.ts — `upload_record_file` (ADR-0095, #1474): the one bounded file write PMO
// performs. Imports the SHIPPED handler and the actual exported builder/allowlist; mocks only
// globalThis.fetch. A target of scripts/m365-preview-upload-mutation.mjs: break an allowlist predicate or an
// authorization step and it MUST go red.
import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  buildUploadRequest,
  sanitizeUploadFileName,
  type UploadContext,
  uploadAllowed,
  validateUploadedItem,
} from "./graphFileUpload.ts";
import { DRIVE, FULL_SCOPES, graphCalls, graphError, gput, graphSummary, makeScenarioRunner, newWorld, READ_SCOPES, SITE } from "./recordFolderTestKit.ts";
import { jsonResponse } from "../_shared/testing/edgeTestKit.ts";
import { openCallerRecordFileUpload, type RecordFileUploadAccess } from "./graphRead.ts";
import { createGraphBudget } from "./folderBudget.ts";
import { MAX_FILE_SIZE_BYTES } from "../../../pmo-portal/src/lib/fileConstants.ts";

const { handler, setTestJwks } = await import("./index.ts");
export const run = makeScenarioRunner(handler, setTestJwks);

const ctx: UploadContext = { driveId: "synthetic-drive", parentId: "synthetic-parent-id", fileName: "Site plan.pdf", bytes: 1234 };

Deno.test("document-preview AC-007 upload builder emits only the exact content PUT", async (t) => {
  await t.step("the builder output is the exact rename-on-conflict PUT and is the only allowed request", () => {
    const request = buildUploadRequest(ctx);
    assertEquals(request, {
      method: "PUT",
      path: "/drives/synthetic-drive/items/synthetic-parent-id:/Site%20plan.pdf:/content",
      query: "@microsoft.graph.conflictBehavior=rename",
      contentType: "application/pdf",
      size: 1234,
    });
    assert(uploadAllowed(request, ctx));
  });

  await t.step("every other request shape is refused", () => {
    const edit = (change: (r: Record<string, unknown>) => void) => {
      const r = structuredClone(buildUploadRequest(ctx)) as unknown as Record<string, unknown>;
      change(r);
      return r;
    };
    const refused: Array<[string, unknown]> = [
      ["POST", edit((r) => { r.method = "POST"; })],
      ["PATCH", edit((r) => { r.method = "PATCH"; })],
      ["lowercase put", edit((r) => { r.method = "put"; })],
      ["conflict replace", edit((r) => { r.query = "@microsoft.graph.conflictBehavior=replace"; })],
      ["conflict fail", edit((r) => { r.query = "@microsoft.graph.conflictBehavior=fail"; })],
      ["no conflict", edit((r) => { r.query = ""; })],
      ["extra query key", edit((r) => { r.query = "@microsoft.graph.conflictBehavior=rename&select=id"; })],
      ["upload session", edit((r) => { r.path = "/drives/synthetic-drive/items/synthetic-parent-id:/Site%20plan.pdf:/createUploadSession"; })],
      ["other drive", edit((r) => { r.path = "/drives/other/items/synthetic-parent-id:/Site%20plan.pdf:/content"; })],
      ["other parent", edit((r) => { r.path = "/drives/synthetic-drive/items/other:/Site%20plan.pdf:/content"; })],
      ["other name", edit((r) => { r.path = "/drives/synthetic-drive/items/synthetic-parent-id:/Other.pdf:/content"; })],
      ["traversal in name", edit((r) => { r.path = "/drives/synthetic-drive/items/synthetic-parent-id:/..%2Fx.pdf:/content"; })],
      ["wrong content type", edit((r) => { r.contentType = "text/html"; })],
      ["octet stream", edit((r) => { r.contentType = "application/octet-stream"; })],
      ["other size", edit((r) => { r.size = 1; })],
      ["extra key", edit((r) => { r.headers = {}; })],
      ["missing key", edit((r) => { delete r.query; })],
      ["null", null],
      ["string", "PUT /drives"],
    ];
    for (const [label, request] of refused) assertFalse(uploadAllowed(request, ctx), label);
  });

  await t.step("unsafe contexts never build or validate", () => {
    const bad: Array<[string, Partial<UploadContext>]> = [
      ["slash id", { parentId: "a/b" }], ["dot id", { parentId: ".." }], ["drive pct", { driveId: "a%2fb" }],
      ["empty name", { fileName: "" }], ["name with slash", { fileName: "a/b.pdf" }], ["backslash", { fileName: "a\\b.pdf" }],
      ["colon", { fileName: "a:b.pdf" }], ["star", { fileName: "a*b.pdf" }], ["question", { fileName: "a?b.pdf" }],
      ["quote", { fileName: 'a"b.pdf' }], ["lt", { fileName: "a<b.pdf" }], ["gt", { fileName: "a>b.pdf" }],
      ["pipe", { fileName: "a|b.pdf" }], ["hash", { fileName: "a#b.pdf" }], ["percent", { fileName: "a%b.pdf" }],
      ["control", { fileName: "a\nb.pdf" }], ["dot dot", { fileName: "a..b.pdf" }], ["over 120", { fileName: `${"x".repeat(120)}.pdf` }],
      ["exe", { fileName: "a.exe" }], ["zip", { fileName: "a.zip" }], ["unlisted", { fileName: "a.html" }], ["no ext", { fileName: "readme" }],
      ["empty file", { bytes: 0 }], ["oversize", { bytes: MAX_FILE_SIZE_BYTES + 1 }], ["fraction", { bytes: 1.5 }],
    ];
    for (const [label, over] of bad) {
      const context = { ...ctx, ...over };
      let built = true;
      try { buildUploadRequest(context); } catch { built = false; }
      assertFalse(built, label);
      assertFalse(uploadAllowed(buildUploadRequest(ctx), context), label);
    }
    // the size cap is inclusive
    assert(uploadAllowed(buildUploadRequest({ ...ctx, bytes: MAX_FILE_SIZE_BYTES }), { ...ctx, bytes: MAX_FILE_SIZE_BYTES }));
  });

  await t.step("sanitizeUploadFileName", () => {
    assertEquals(sanitizeUploadFileName("a/b:c.pdf"), "a b c.pdf");
    assertEquals(sanitizeUploadFileName("  ..report..  .PDF "), "report .PDF");
    assertEquals(sanitizeUploadFileName("Café.pdf"), "Café.pdf");
    assertEquals(sanitizeUploadFileName("a\u0000b\nc.png"), "a b c.png");
    assertEquals(Array.from(sanitizeUploadFileName(`${"x".repeat(200)}.pdf`)).length, 120);
    assert(sanitizeUploadFileName(`${"x".repeat(200)}.pdf`).endsWith(".pdf"));
    assertEquals(sanitizeUploadFileName("///"), "");
    // sanitized output is a fixed point
    for (const name of ["a/b:c.pdf", "  ..x.. .pdf", "q?.docx"]) {
      const once = sanitizeUploadFileName(name);
      assertEquals(sanitizeUploadFileName(once), once);
    }
  });

  await t.step("validateUploadedItem returns a reference only for a file directly under the parent", () => {
    const item = (over: Record<string, unknown> = {}) => ({
      id: "synthetic-new-item", name: "Site plan 1.pdf", webUrl: "https://synthetic.sharepoint.com/sites/x/Site%20plan%201.pdf",
      file: { mimeType: "application/pdf" }, parentReference: { driveId: "synthetic-drive", id: "synthetic-parent-id" }, ...over,
    });
    const scope = { driveId: "synthetic-drive", parentId: "synthetic-parent-id" };
    assertEquals(validateUploadedItem(item(), scope), {
      drive_id: "synthetic-drive", item_id: "synthetic-new-item", name: "Site plan 1.pdf",
      web_url: "https://synthetic.sharepoint.com/sites/x/Site%20plan%201.pdf", item_kind: "file",
    });
    const refused: Array<[string, unknown]> = [
      ["null", null], ["array", []],
      ["folder facet", item({ file: undefined, folder: {} })], ["both facets", item({ folder: {} })], ["no facet", item({ file: undefined })],
      ["unsafe id", item({ id: "a/b" })], ["no name", item({ name: "" })], ["number name", item({ name: 3 })],
      ["no webUrl", item({ webUrl: undefined })], ["http webUrl", item({ webUrl: "http://x.sharepoint.com/a" })],
      ["other parent", item({ parentReference: { driveId: "synthetic-drive", id: "other" } })],
      ["other drive", item({ parentReference: { driveId: "other", id: "synthetic-parent-id" } })],
      ["no parentReference", item({ parentReference: undefined })],
    ];
    for (const [label, raw] of refused) assertEquals(validateUploadedItem(raw, scope), null, label);
  });
});

const PUT_PATH = `/drives/${DRIVE}/items/synthetic-parent-id:/Site plan.pdf:/content`;
const BYTES = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
const driveItem = (over: Record<string, unknown> = {}) => ({
  id: "synthetic-new-item", name: "Site plan.pdf", webUrl: "https://synthetic.sharepoint.com/sites/x/Site%20plan.pdf",
  file: { mimeType: "application/pdf" }, parentReference: { driveId: DRIVE, id: "synthetic-parent-id" }, ...over,
});

async function uploadOutcome(route: Parameters<typeof gput>[1], over: Parameters<typeof newWorld>[0] = {}) {
  return await run(newWorld({ graph: [gput(PUT_PATH, route)], ...over }), async (sc) => {
    const access = await openCallerRecordFileUpload(sc.deps, { site_id: SITE, drive_id: DRIVE }, createGraphBudget(30_000));
    assert("uploadFile" in access);
    return { outcome: await (access as RecordFileUploadAccess).uploadFile("synthetic-parent-id", "Site plan.pdf", BYTES), calls: sc.calls };
  });
}

Deno.test("document-preview AC-007 upload transport", async (t) => {
  await t.step("sends one bearer PUT of the raw bytes with the server-derived content type", async () => {
    const { outcome, calls } = await uploadOutcome(() => jsonResponse(driveItem(), { status: 201 }));
    assertEquals(outcome.kind, "ok");
    assertEquals(graphSummary(calls), [`PUT ${PUT_PATH}`]);
    const call = graphCalls(calls)[0]!;
    assertEquals(call.url.search, "?@microsoft.graph.conflictBehavior=rename");
    assertEquals(call.headers.get("content-type"), "application/pdf");
    assertEquals(call.headers.get("authorization"), "Bearer synthetic-access-token");
    assertEquals(call.bodyText, new TextDecoder().decode(BYTES));
    assertEquals(call.redirect, "error");
  });

  await t.step("a 200 answer is also accepted", async () => {
    assertEquals((await uploadOutcome(() => jsonResponse(driveItem()))).outcome.kind, "ok");
  });

  await t.step("missing Sites.Selected is refused before any refresh or Graph call", async () => {
    const { calls, result } = await run(newWorld({ scopes: READ_SCOPES, accessExpired: true }), async (sc) => ({
      result: await openCallerRecordFileUpload(sc.deps, { site_id: SITE, drive_id: DRIVE }, createGraphBudget(30_000)),
      calls: sc.calls,
    }));
    assertEquals((result as { status: number }).status, 403);
    assertEquals((result as { body: { error: string } }).body.error, "SCOPE_INSUFFICIENT");
    assertEquals(graphCalls(calls).length, 0);
    assertEquals(calls.filter((c) => c.url.host === "login.microsoftonline.com").length, 0);
  });

  await t.step("a refresh that drops the Sites.Selected grant is re-checked before the write", async () => {
    const { outcome, calls } = await uploadOutcome(() => jsonResponse(driveItem(), { status: 201 }), {
      accessExpired: true,
      refresh: () => jsonResponse({
        access_token: "synthetic-new-access", refresh_token: "synthetic-new-refresh", expires_in: 3600,
        scope: "Files.Read Files.Read.All Sites.Read.All offline_access",
      }),
    });
    assertEquals(outcome.kind, "unavailable");
    assertEquals((outcome as { result?: { status: number } }).result?.status, 403);
    assertEquals(graphCalls(calls).length, 0);
  });

  const cases: Array<[string, () => Response, string]> = [
    ["403", () => graphError(403, "accessDenied"), "forbidden"],
    ["404 parent gone", () => graphError(404, "itemNotFound"), "not_found"],
    ["409", () => graphError(409, "nameAlreadyExists"), "unavailable"],
    ["413", () => graphError(413, "payloadTooLarge"), "unavailable"],
    ["507", () => graphError(507, "quotaLimitReached"), "unavailable"],
    ["500", () => graphError(500, "generalException"), "unavailable"],
    ["200 with a non-object body", () => jsonResponse([]), "unavailable"],
    ["204", () => new Response(null, { status: 204 }), "unavailable"],
  ];
  for (const [label, respond, kind] of cases) {
    await t.step(`${label} -> ${kind} and is never retried`, async () => {
      const { outcome, calls } = await uploadOutcome(respond);
      assertEquals(outcome.kind, kind);
      assertEquals(graphCalls(calls).length, 1);
    });
  }

  await t.step("an invalid context never reaches the network", async () => {
    const world = newWorld({ graph: [] });
    await run(world, async (sc) => {
      const access = await openCallerRecordFileUpload(sc.deps, { site_id: SITE, drive_id: DRIVE }, createGraphBudget(30_000)) as RecordFileUploadAccess;
      assertEquals((await access.uploadFile("a/b", "x.pdf", BYTES)).kind, "unavailable");
      assertEquals((await access.uploadFile("p", "x.exe", BYTES)).kind, "unavailable");
      assertEquals((await access.uploadFile("p", "x.pdf", new Uint8Array())).kind, "unavailable");
      assertEquals(graphCalls(sc.calls).length, 0);
    });
  });

  await t.step("only the single mutator is exposed", async () => {
    await run(newWorld(), async (sc) => {
      const access = await openCallerRecordFileUpload(sc.deps, { site_id: SITE, drive_id: DRIVE }, createGraphBudget(30_000));
      assertEquals(Object.keys(access).sort(), ["uploadFile"]);
    });
  });
});
