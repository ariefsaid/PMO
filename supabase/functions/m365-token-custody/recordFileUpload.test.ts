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
import { CASE_ID, DRIVE, graphCalls, graphError, gput, graphSummary, makeScenarioRunner, newWorld, ORG, PROJECT_ID, READ_SCOPES, rpcBodies, SITE, settingsRow, USER, type World } from "./recordFolderTestKit.ts";
import { parseUploadRequest } from "./recordFileUpload.ts";
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
const BYTES: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(8)); BYTES.set([37, 80, 68, 70, 45, 49, 46, 55]);
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

// ── served handler ───────────────────────────────────────────────────────────────────────────────
const DOC_ID = "10200000-0000-0000-0000-0000000000d2";
const PARENT_ID = "synthetic-parent-id";
const NOT_RECORD = "This record is not available.";
const docRow = (over: Record<string, unknown> = {}) => ({
  id: DOC_ID, org_id: ORG, project_id: PROJECT_ID, status: "Draft", author_id: USER, source: null, ...over,
});
const folderRow = (over: Record<string, unknown> = {}) => ({
  id: "10200000-0000-0000-0000-0000000000f2", ms_drive_id: DRIVE, ms_item_id: PARENT_ID, ms_item_kind: "folder", ms_linked_at: "2026-10-01T00:00:00Z", ...over,
});
/** project_documents / procurement_documents: the target row for `id=eq.` reads, the folder reference otherwise. */
const registers = (target: Record<string, unknown>[] = [docRow()], folders: Record<string, unknown>[] = [folderRow()]) =>
  (call: { url: URL }) => call.url.searchParams.get("id")?.startsWith("eq.") ? target : folders;
const okPut = () => gput(PUT_PATH, () => jsonResponse(driveItem({ name: "Site plan 1.pdf" }), { status: 201 }));

const file = (name = "Site plan.pdf", bytes: Uint8Array<ArrayBuffer> = BYTES, type = "application/pdf") => new File([bytes], name, { type });
function projectForm(f: File | string = file(), over: Record<string, string | File | null> = {}): FormData {
  const fd = new FormData();
  const fields: Record<string, string | File | null> = { action: "upload_record_file", target_kind: "project_document", target_id: DOC_ID, file: f, ...over };
  for (const [k, v] of Object.entries(fields)) if (v !== null) fd.append(k, v);
  return fd;
}
function purchaseForm(over: Record<string, string | File | null> = {}): FormData {
  const fd = new FormData();
  const fields: Record<string, string | File | null> = { action: "upload_record_file", target_kind: "procurement_file", phase: "receipt", parent_id: DOC_ID, file: file(), ...over };
  for (const [k, v] of Object.entries(fields)) if (v !== null) fd.append(k, v);
  return fd;
}
async function serveUpload(world: World, body: FormData, authorized = true) {
  return await run(world, async (sc) => {
    const res = await handler(new Request("http://edge.test/m365-token-custody", {
      method: "POST", headers: authorized ? { Authorization: `Bearer ${sc.token}` } : {}, body,
    }));
    return { res, json: await res.json().catch(() => null) as Record<string, unknown> | null, calls: sc.calls };
  });
}
const dbCalls = (calls: { url: URL }[], name: string) => calls.filter((c) => c.url.pathname === `/rest/v1/${name}`);

Deno.test("document-preview AC-007 the multipart contract is exactly one file plus the target fields", async (t) => {
  await t.step("accepts the project and purchase shapes, ignoring the browser content type", async () => {
    const project = await parseUploadRequest(projectForm(file("Site plan.pdf", BYTES, "text/html")));
    assertEquals(project?.target, { kind: "project_document", id: DOC_ID });
    assertEquals(project?.fileName, "Site plan.pdf");
    assertEquals(project?.bytes, BYTES);
    const purchase = await parseUploadRequest(purchaseForm());
    assertEquals(purchase?.target, { kind: "procurement_file", phase: "receipt", parent_id: DOC_ID });
  });

  await t.step("sanitizes the name server-side", async () => {
    assertEquals((await parseUploadRequest(projectForm(file("a/b:c.pdf"))))?.fileName, "a b c.pdf");
  });

  await t.step("rejects everything else", async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    const two = projectForm();
    two.append("file", file());
    const refused: Array<[string, FormData]> = [
      ["extra drive field", projectForm(file(), { drive_id: "d" })],
      ["extra parent_item_id", projectForm(file(), { parent_item_id: "p" })],
      ["extra folder/path/name/conflict", projectForm(file(), { folder: "x", path: "y", name: "z", conflict: "replace" })],
      ["project form with purchase fields", projectForm(file(), { phase: "receipt" })],
      ["purchase form with target_id", purchaseForm({ target_id: DOC_ID })],
      ["wrong action", projectForm(file(), { action: "ensure_record_folder" })],
      ["unknown kind", projectForm(file(), { target_kind: "budget" })],
      ["non-uuid target", projectForm(file(), { target_id: "x" })],
      ["non-uuid parent", purchaseForm({ parent_id: "x" })],
      ["unknown phase", purchaseForm({ phase: "nope" })],
      ["missing phase", purchaseForm({ phase: null })],
      ["no file part", projectForm(file(), { file: null })],
      ["file is a string", projectForm("not a file")],
      ["two file parts", two],
      ["empty file", projectForm(file("a.pdf", new Uint8Array()))],
      ["oversize", projectForm(file("a.pdf", big))],
      ["denied extension", projectForm(file("a.exe"))],
      ["archive", projectForm(file("a.zip"))],
      ["unlisted extension", projectForm(file("a.html"))],
      ["no extension", projectForm(file("readme"))],
      ["name that sanitizes away", projectForm(file("///"))],
    ];
    for (const [label, form] of refused) assertEquals(await parseUploadRequest(form), null, label);
    // exactly at the cap is fine
    assert(await parseUploadRequest(projectForm(file("a.pdf", new Uint8Array(5 * 1024 * 1024)))));
  });
});

Deno.test("document-preview AC-007 the shipped handler uploads into the record folder and returns the reference", async (t) => {
  await t.step("project document: one PUT into the record folder, the returned name wins, no token in the answer", async () => {
    const { res, json, calls } = await serveUpload(newWorld({ documents: registers(), graph: [okPut()] }), projectForm());
    assertEquals(res.status, 200);
    assertEquals(json, { reference: {
      drive_id: DRIVE, item_id: "synthetic-new-item", name: "Site plan 1.pdf",
      web_url: "https://synthetic.sharepoint.com/sites/x/Site%20plan.pdf", item_kind: "file",
    } });
    assertEquals(graphSummary(calls), [`PUT ${PUT_PATH}`]);
    const put = graphCalls(calls)[0]!;
    assertEquals(put.url.search, "?@microsoft.graph.conflictBehavior=rename");
    assertEquals(put.headers.get("content-type"), "application/pdf");
    assertEquals(put.bodyText, new TextDecoder().decode(BYTES));
    for (const secret of ["access_token", "refresh_token", "synthetic-access-token"]) assertFalse(JSON.stringify(json).includes(secret));
    // custody never writes a PMO table and never touches Storage
    assertEquals(calls.filter((c) => c.method !== "GET" && /^\/rest\/v1\/(project_documents|procurement_documents|[a-z_]+_files)$/u.test(c.url.pathname)).length, 0);
    assertEquals(calls.filter((c) => c.url.pathname.startsWith("/storage/")).length, 0);
    // a metadata-only audit row, no file name or URL
    const audits = rpcBodies(calls, "audit_m365_event");
    assertEquals(audits.length, 1);
    assertEquals(audits[0], { p_action: "m365.file_uploaded", p_org_id: ORG, p_actor_id: USER, p_entity_id: DOC_ID, p_detail: { kind: "project_document" } });
  });

  await t.step("purchase file: the purchase case's folder via the phase parent", async () => {
    const world = newWorld({
      documents: (call) => call.url.searchParams.get("procurement_id") === `eq.${CASE_ID}` ? [folderRow()] : [],
      tables: { procurement_receipts: [{ id: DOC_ID, org_id: ORG, procurement_id: CASE_ID }] },
      graph: [okPut()],
    });
    const { res, json, calls } = await serveUpload(world, purchaseForm());
    assertEquals(res.status, 200);
    assertEquals((json?.reference as { item_id: string }).item_id, "synthetic-new-item");
    assertEquals(graphSummary(calls), [`PUT ${PUT_PATH}`]);
  });

  await t.step("an Admin may upload to someone else's Draft", async () => {
    const { res } = await serveUpload(newWorld({ role: "Admin", documents: registers([docRow({ author_id: "someone-else" })]), graph: [okPut()] }), projectForm());
    assertEquals(res.status, 200);
  });

  await t.step("the upload quota answers 429 before any connection or Graph call", async () => {
    const { res, json, calls } = await serveUpload(newWorld({ documents: registers(), graph: [okPut()], rate: () => jsonResponse(false) }), projectForm());
    assertEquals([res.status, json?.error], [429, "RATE_LIMITED"]);
    assertEquals(graphCalls(calls).length, 0);
    assertEquals(dbCalls(calls, "ms_graph_connections").length, 0);
  });

  await t.step("no JWT is a 401 before the body is read", async () => {
    const { res, calls } = await serveUpload(newWorld({ documents: registers(), graph: [okPut()] }), projectForm(), false);
    assertEquals(res.status, 401);
    assertEquals(graphCalls(calls).length, 0);
    assertEquals(dbCalls(calls, "project_documents").length, 0);
  });

  await t.step("a JSON body still routes as before", async () => {
    await run(newWorld(), async (sc) => {
      const res = await sc.call({ action: "connection_status" });
      assert(res.status !== 400 || (await res.json()).message !== "invalid form body");
    });
  });
});

Deno.test("document-preview AC-008 a connected organisation never falls back to private Storage and writes nothing on failure", async (t) => {
  const failures: Array<[string, Partial<World>, number, string]> = [
    ["Microsoft refuses the write", { graph: [gput(PUT_PATH, () => graphError(403, "accessDenied"))] }, 403, "SOURCE_ACCESS_DENIED"],
    ["the folder item is gone", { graph: [gput(PUT_PATH, () => graphError(404, "itemNotFound"))] }, 409, "RECORD_FOLDER_UNAVAILABLE"],
    ["no Sites.Selected consent", { scopes: READ_SCOPES, graph: [okPut()] }, 403, "SCOPE_INSUFFICIENT"],
    ["no connection", { connectionMissing: true, graph: [okPut()] }, 404, "NOT_CONNECTED"],
    ["stale connection", { connectionStatus: "stale", graph: [okPut()] }, 409, "CONNECTION_STALE"],
    ["revoked connection", { connectionStatus: "revoked", graph: [okPut()] }, 410, "CONNECTION_REVOKED"],
    ["5xx", { graph: [gput(PUT_PATH, () => graphError(500, "generalException"))] }, 502, "GRAPH_ERROR"],
    ["wrong parent in the answer", { graph: [gput(PUT_PATH, () => jsonResponse(driveItem({ parentReference: { driveId: DRIVE, id: "elsewhere" } }), { status: 201 }))] }, 502, "GRAPH_ERROR"],
    ["folder facet in the answer", { graph: [gput(PUT_PATH, () => jsonResponse(driveItem({ file: undefined, folder: {} }), { status: 201 }))] }, 502, "GRAPH_ERROR"],
    ["no webUrl in the answer", { graph: [gput(PUT_PATH, () => jsonResponse(driveItem({ webUrl: undefined }), { status: 201 }))] }, 502, "GRAPH_ERROR"],
  ];
  for (const [label, over, status, code] of failures) {
    await t.step(label, async () => {
      const { res, json, calls } = await serveUpload(newWorld({ documents: registers(), ...over }), projectForm());
      assertEquals([res.status, json?.error], [status, code]);
      assertEquals(json?.reference, undefined);
      assertEquals(calls.filter((c) => c.url.pathname.startsWith("/storage/")).length, 0);
      assertEquals(calls.filter((c) => c.method !== "GET" && /^\/rest\/v1\/(project_documents|procurement_documents|[a-z_]+_files)$/u.test(c.url.pathname)).length, 0);
      assertEquals(rpcBodies(calls, "audit_m365_event").length, 0);
      assertFalse(JSON.stringify(json).includes("synthetic upstream text"));
    });
  }

  await t.step("a missing folder, an unset library or a folder outside the library is a recovery state with no Graph call", async () => {
    const cases: Array<[string, Partial<World>]> = [
      ["no folder reference", { documents: registers([docRow()], []) }],
      ["no default library", { documents: registers(), settings: [] }],
      ["folder in another drive", { documents: registers([docRow()], [folderRow({ ms_drive_id: "other-drive" })]) }],
      ["unsafe folder item id", { documents: registers([docRow()], [folderRow({ ms_item_id: "a/b" })]) }],
    ];
    for (const [label, over] of cases) {
      const { res, json, calls } = await serveUpload(newWorld({ graph: [okPut()], ...over }), projectForm());
      assertEquals([res.status, json?.error], [409, "RECORD_FOLDER_UNAVAILABLE"], label);
      assertEquals(graphCalls(calls).length, 0, label);
      assertEquals(dbCalls(calls, "ms_graph_connections").length, 0, label);
    }
  });

  await t.step("the folder is never created by an upload", async () => {
    const { calls } = await serveUpload(newWorld({ documents: registers([docRow()], []), graph: [okPut()] }), projectForm());
    assertEquals(graphCalls(calls).filter((c) => c.method === "POST").length, 0);
    assertEquals(rpcBodies(calls, "m365_link_record_folder").length, 0);
  });
});

Deno.test("document-preview AC-014 upload refuses an unreadable or unwritable target before any Microsoft operation", async (t) => {
  const settings = [settingsRow()];
  const refusals: Array<[string, Partial<World>, FormData, number, string]> = [
    ["other-org project document", { documents: registers([docRow({ org_id: "other-org" })]) }, projectForm(), 404, "SOURCE_NOT_FOUND"],
    ["RLS hides the project document", { documents: registers([]) }, projectForm(), 404, "SOURCE_NOT_FOUND"],
    ["a different id comes back", { documents: registers([docRow({ id: "10200000-0000-0000-0000-0000000000ee" })]) }, projectForm(), 404, "SOURCE_NOT_FOUND"],
    ["non-Draft document", { documents: registers([docRow({ status: "Issued" })]) }, projectForm(), 403, "FORBIDDEN"],
    ["someone else's Draft as a non-Admin", { documents: registers([docRow({ author_id: "someone-else" })]) }, projectForm(), 403, "FORBIDDEN"],
    ["already a Microsoft reference", { documents: registers([docRow({ source: "onedrive" })]) }, projectForm(), 403, "FORBIDDEN"],
    ["read-only role", { role: "Engineer", documents: registers() }, projectForm(), 403, "FORBIDDEN"],
    ["viewer-class role on a purchase", { role: "Viewer", tables: { procurement_receipts: [{ id: DOC_ID, org_id: ORG, procurement_id: CASE_ID }] }, documents: registers([], [folderRow()]) }, purchaseForm(), 403, "FORBIDDEN"],
    ["unknown phase parent", { documents: registers([], [folderRow()]), tables: { procurement_receipts: [] } }, purchaseForm(), 404, "SOURCE_NOT_FOUND"],
    ["phase parent in another org", { documents: registers([], [folderRow()]), tables: { procurement_receipts: [{ id: DOC_ID, org_id: "other-org", procurement_id: CASE_ID }] } }, purchaseForm(), 404, "SOURCE_NOT_FOUND"],
  ];
  for (const [label, over, form, status, code] of refusals) {
    await t.step(label, async () => {
      const { res, json, calls } = await serveUpload(newWorld({ graph: [okPut()], settings, ...over }), form);
      assertEquals([res.status, json?.error], [status, code], label);
      assertEquals(graphCalls(calls).length, 0);
      assertEquals(dbCalls(calls, "ms_graph_connections").length, 0);
      assertEquals(calls.filter((c) => c.url.pathname.startsWith("/storage/")).length, 0);
      const text = JSON.stringify(json);
      for (const leak of [DOC_ID, CASE_ID, PROJECT_ID, DRIVE, "other-org", "project_documents"]) assertFalse(text.includes(leak), leak);
    });
  }

  await t.step("a read-only role reads no record and no connection", async () => {
    const { calls } = await serveUpload(newWorld({ role: "Engineer", documents: registers(), graph: [okPut()] }), projectForm());
    assertEquals(dbCalls(calls, "project_documents").length, 0);
    assertEquals(dbCalls(calls, "org_m365_document_settings").length, 0);
  });
});
