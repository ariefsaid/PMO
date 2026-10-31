// documentPreview.test.ts — `preview_document` (ADR-0095, #1474). Imports the SHIPPED handler and the
// actual exported builder/allowlist; mocks only globalThis.fetch. It is a target of
// scripts/m365-preview-upload-mutation.mjs: break the allowlist or an authorization step and it MUST go red.
import { assert, assertEquals, assertFalse, assertThrows } from "@std/assert";
import { assertStringIncludes } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { DRIVE, gget, graphCalls, graphError, graphSummary, gpost, makeScenarioRunner, newWorld, ORG, READ_SCOPES, USER, type World } from "./recordFolderTestKit.ts";
import { jsonResponse } from "../_shared/testing/edgeTestKit.ts";
import { openCallerDocumentPreview, type DocumentPreviewAccess } from "./graphRead.ts";
import { ERROR_STATUS } from "./types.ts";
import { parsePreviewRequest } from "./documentPreview.ts";
import { buildPreviewRequest, previewAllowed, readPreviewGetUrl } from "./graphPreview.ts";

const { handler, setTestJwks } = await import("./index.ts");
export const run = makeScenarioRunner(handler, setTestJwks);

const ctx = { driveId: "synthetic-drive", itemId: "synthetic-item" };

Deno.test("document-preview AC-003 preview builder emits only the exact POST", async (t) => {
  await t.step("builder output is the exact preview POST and is the only allowed request", () => {
    const request = buildPreviewRequest(ctx);
    assertEquals(request, {
      method: "POST",
      path: "/drives/synthetic-drive/items/synthetic-item/preview",
      body: {},
    });
    assert(previewAllowed(request, ctx));
  });

  await t.step("every other request shape is refused", () => {
    const base = () => structuredClone(buildPreviewRequest(ctx)) as unknown as Record<string, unknown>;
    const edit = (change: (r: Record<string, unknown>) => void) => {
      const r = base();
      change(r);
      return r;
    };
    const refused: Array<[string, unknown]> = [
      ["PATCH", edit((r) => { r.method = "PATCH"; })],
      ["PUT", edit((r) => { r.method = "PUT"; })],
      ["GET", edit((r) => { r.method = "GET"; })],
      ["lowercase post", edit((r) => { r.method = "post"; })],
      ["other drive", edit((r) => { r.path = "/drives/other/items/synthetic-item/preview"; })],
      ["other item", edit((r) => { r.path = "/drives/synthetic-drive/items/other/preview"; })],
      ["body with keys", edit((r) => { r.body = { page: "1" }; })],
      ["extra top-level key", edit((r) => { r.headers = {}; })],
      ["content path", edit((r) => { r.path = "/drives/synthetic-drive/items/synthetic-item/content"; })],
      ["children path", edit((r) => { r.path = "/drives/synthetic-drive/items/synthetic-item/children"; })],
      ["createLink path", edit((r) => { r.path = "/drives/synthetic-drive/items/synthetic-item/createLink"; })],
      ["query on path", edit((r) => { r.path += "?x=1"; })],
      ["missing body", edit((r) => { delete r.body; })],
      ["array body", edit((r) => { r.body = []; })],
      ["null", null],
      ["string", "POST /drives"],
    ];
    for (const [label, request] of refused) assertFalse(previewAllowed(request, ctx), label);
  });

  await t.step("unsafe identifiers never build or validate", () => {
    for (const unsafe of ["a/b", "a\\b", "..", ".", "a%2fb", "a b", "a?b", "a#b", ""]) {
      assertThrows(() => buildPreviewRequest({ ...ctx, itemId: unsafe }), Error, undefined, unsafe);
      assertThrows(() => buildPreviewRequest({ ...ctx, driveId: unsafe }), Error, undefined, unsafe);
      assertFalse(previewAllowed(buildPreviewRequest(ctx), { ...ctx, itemId: unsafe }), unsafe);
    }
  });

  await t.step("only an embeddable getUrl is read from the answer", () => {
    assertEquals(readPreviewGetUrl({ getUrl: "https://x.sharepoint.com/e" }), "https://x.sharepoint.com/e");
    assertEquals(readPreviewGetUrl({ postUrl: "https://x.sharepoint.com/e" }), null);
    assertEquals(readPreviewGetUrl(null), null);
    assertEquals(readPreviewGetUrl([]), null);
  });
});

Deno.test("document-preview AC-003 preview error vocabulary maps to its statuses", () => {
  assertEquals(ERROR_STATUS.SOURCE_ACCESS_DENIED, 403);
  assertEquals(ERROR_STATUS.SOURCE_NOT_FOUND, 404);
  assertEquals(ERROR_STATUS.PREVIEW_UNSUPPORTED, 422);
  assertEquals(ERROR_STATUS.RECORD_FOLDER_UNAVAILABLE, 409);
});

const PREVIEW_PATH = "/drives/synthetic-drive/items/synthetic-item/preview";
const EMBED = "https://synthetic.sharepoint.com/sites/x/_layouts/15/embed.aspx?a=b";

async function previewOutcome(route: Parameters<typeof gpost>[1], over: Parameters<typeof newWorld>[0] = {}) {
  return await run(newWorld({ graph: [gpost(PREVIEW_PATH, route)], ...over }), async (sc) => {
    const access = await openCallerDocumentPreview(sc.deps);
    assert("previewItem" in access);
    return { outcome: await (access as DocumentPreviewAccess).previewItem("synthetic-drive", "synthetic-item"), calls: sc.calls };
  });
}

Deno.test("document-preview AC-003 preview transport", async (t) => {
  await t.step("sends exactly one bearer POST with an empty body", async () => {
    const { outcome, calls } = await previewOutcome(() => jsonResponse({ getUrl: EMBED }));
    assertEquals(outcome, { kind: "ok", url: EMBED });
    assertEquals(graphSummary(calls), [`POST ${PREVIEW_PATH}`]);
    const call = graphCalls(calls)[0]!;
    assertEquals(call.headers.get("authorization"), "Bearer synthetic-access-token");
    assertEquals(call.bodyJson, {});
    assertEquals(call.redirect, "error");
  });

  await t.step("a connection without a Files read grant is refused before any refresh or Graph call", async () => {
    const world = newWorld({ scopes: ["offline_access"], accessExpired: true, graph: [] });
    const { calls, result } = await run(world, async (sc) => ({ result: await openCallerDocumentPreview(sc.deps), calls: sc.calls }));
    assertEquals((result as { status: number }).status, 403);
    assertEquals((result as { body: { error: string } }).body.error, "SCOPE_INSUFFICIENT");
    assertEquals(graphCalls(calls).length, 0);
    assertEquals(calls.filter((c) => c.url.host === "login.microsoftonline.com").length, 0);
  });

  await t.step("the Files read grant alone is enough (no write grant)", async () => {
    const { outcome } = await previewOutcome(() => jsonResponse({ getUrl: EMBED }), { scopes: READ_SCOPES });
    assertEquals(outcome.kind, "ok");
  });

  const cases: Array<[string, () => Response, string]> = [
    ["403", () => graphError(403, "accessDenied"), "forbidden"],
    ["404 itemNotFound", () => graphError(404, "itemNotFound"), "not_found"],
    ["400 notSupported", () => graphError(400, "notSupported"), "unsupported"],
    ["415", () => graphError(415, "unsupportedMediaType"), "unsupported"],
    ["200 without getUrl (postUrl only)", () => jsonResponse({ postUrl: EMBED }), "unsupported"],
    ["200 with a non-Microsoft host", () => jsonResponse({ getUrl: "https://evil.example/e" }), "unavailable"],
    ["200 with a non-https url", () => jsonResponse({ getUrl: "http://synthetic.sharepoint.com/e" }), "unavailable"],
    ["500", () => graphError(500, "generalException"), "unavailable"],
    ["401", () => graphError(401, "InvalidAuthenticationToken"), "unavailable"],
  ];
  for (const [label, respond, kind] of cases) {
    await t.step(`${label} -> ${kind}`, async () => {
      const { outcome } = await previewOutcome(respond);
      assertEquals(outcome.kind, kind);
    });
  }

  await t.step("429 / 503 carry a capped Retry-After", async () => {
    for (const status of [429, 503]) {
      const { outcome } = await previewOutcome(() => graphError(status, "tooManyRequests", { "Retry-After": "120" }));
      assertEquals(outcome, { kind: "unavailable", retryAfter: 30 });
    }
  });
});

const UUID_A = "10200000-0000-0000-0000-0000000000a1";

Deno.test("document-preview AC-003 preview request parsing", async (t) => {
  await t.step("accepts exactly the typed shapes", () => {
    for (const kind of ["project_document", "procurement_document", "budget_link"] as const) {
      assertEquals(parsePreviewRequest({ action: "preview_document", kind, id: UUID_A }), { action: "preview_document", kind, id: UUID_A });
      assertEquals(
        parsePreviewRequest({ action: "preview_document", kind, id: UUID_A, child_item_id: "synthetic-child" }),
        { action: "preview_document", kind, id: UUID_A, child_item_id: "synthetic-child" },
      );
    }
    assertEquals(
      parsePreviewRequest({ action: "preview_document", kind: "procurement_file", phase: "receipt", id: UUID_A }),
      { action: "preview_document", kind: "procurement_file", phase: "receipt", id: UUID_A },
    );
  });

  await t.step("rejects extra keys, bad ids, unknown kinds and phases, and a child on a purchase file", () => {
    const base = { action: "preview_document", kind: "project_document", id: UUID_A };
    const bad: unknown[] = [
      null, "x", [], {},
      { ...base, path: "/drives/x" }, { ...base, drive_id: "d" }, { ...base, item_id: "i" },
      { ...base, url: "https://x" }, { ...base, method: "GET" },
      { ...base, id: "not-a-uuid" }, { ...base, id: 7 }, { ...base, kind: "rfq" }, { ...base, kind: undefined },
      { ...base, action: "graph_proxy" },
      { ...base, child_item_id: "a/b" }, { ...base, child_item_id: ".." }, { ...base, child_item_id: "" }, { ...base, child_item_id: 3 },
      { action: "preview_document", kind: "procurement_file", id: UUID_A },
      { action: "preview_document", kind: "procurement_file", phase: "nope", id: UUID_A },
      { action: "preview_document", kind: "procurement_file", phase: "receipt", id: UUID_A, child_item_id: "c" },
      { action: "preview_document", kind: "procurement_file", phase: "receipt", id: UUID_A, extra: 1 },
      { ...base, phase: "receipt" },
    ];
    for (const body of bad) assertEquals(parsePreviewRequest(body), null, JSON.stringify(body));
  });
});

// ── served handler ───────────────────────────────────────────────────────────────────────────────
const DOC_ID = "10200000-0000-0000-0000-0000000000d1";
const FILE_ID = "10200000-0000-0000-0000-0000000000f1";
const REF_ITEM = "synthetic-item";
const NOT_AVAILABLE = "This document is not available.";
const msRow = (over: Record<string, unknown> = {}) => ({
  id: DOC_ID, org_id: ORG, source: "onedrive", ms_drive_id: DRIVE, ms_item_id: REF_ITEM, ms_item_name: "Plan.pdf", ms_item_kind: "file", ...over,
});
const previewBody = (over: Record<string, unknown> = {}) => ({ action: "preview_document", kind: "project_document", id: DOC_ID, ...over });
const okPreview = () => gpost(PREVIEW_PATH, () => jsonResponse({ getUrl: EMBED }));
const dbCalls = (calls: { url: URL }[], name: string) => calls.filter((c) => c.url.pathname === `/rest/v1/${name}`);

async function serve(world: World, body: unknown) {
  return await run(world, async (sc) => {
    const res = await sc.call(body);
    return { res, json: await res.json().catch(() => null) as Record<string, unknown> | null, calls: sc.calls };
  });
}

Deno.test("document-preview AC-014 an unreadable record returns a sanitized refusal before any Microsoft or signed-link call", async (t) => {
  const refusals: Array<[string, Partial<World>, Record<string, unknown>]> = [
    ["RLS hides the row", { documents: [] }, previewBody()],
    ["row in another org", { documents: [msRow({ org_id: "other-org" })] }, previewBody()],
    ["row is a different id", { documents: [msRow({ id: "10200000-0000-0000-0000-0000000000ee" })] }, previewBody()],
    ["private upload row", { documents: [msRow({ source: "upload", ms_drive_id: null, ms_item_id: null })] }, previewBody()],
    ["no source", { documents: [msRow({ source: null })] }, previewBody()],
    ["file reference with a child id", { documents: [msRow()] }, previewBody({ child_item_id: "synthetic-child" })],
    ["missing drive", { documents: [msRow({ ms_drive_id: null })] }, previewBody()],
    ["budget link hidden", { tables: { budget_version_document_links: [] } }, previewBody({ kind: "budget_link" })],
    ["budget link in another org", { tables: { budget_version_document_links: [msRow({ org_id: "other-org", source: undefined })] } }, previewBody({ kind: "budget_link" })],
    ["archived purchase file", { tables: { procurement_receipt_files: [msRow({ archived_at: "2026-10-01T00:00:00Z" })] } }, previewBody({ kind: "procurement_file", phase: "receipt" })],
    ["private purchase file", { tables: { procurement_receipt_files: [msRow({ source: null })] } }, previewBody({ kind: "procurement_file", phase: "receipt" })],
  ];
  for (const [label, over, body] of refusals) {
    await t.step(label, async () => {
      const { res, json, calls } = await serve(newWorld({ graph: [okPreview()], ...over }), body);
      assertEquals(res.status, 404, label);
      assertEquals(json, { error: "SOURCE_NOT_FOUND", message: NOT_AVAILABLE });
      assertEquals(graphCalls(calls).length, 0);
      assertEquals(dbCalls(calls, "ms_graph_connections").length, 0);
      assertEquals(calls.filter((c) => c.url.pathname.startsWith("/storage/")).length, 0);
      const text = JSON.stringify(json);
      for (const leak of [DOC_ID, DRIVE, REF_ITEM, "project_documents", "other-org"]) assertFalse(text.includes(leak), leak);
    });
  }

  await t.step("a folder reference without a child is not previewable", async () => {
    const { res, json, calls } = await serve(newWorld({ documents: [msRow({ ms_item_kind: "folder" })], graph: [okPreview()] }), previewBody());
    assertEquals(res.status, 422);
    assertEquals(json?.error, "PREVIEW_UNSUPPORTED");
    assertEquals(graphCalls(calls).length, 0);
  });

  await t.step("a malformed body, an extra key and a missing JWT never reach the data or Microsoft", async () => {
    for (const body of [{ action: "preview_document", kind: "project_document" }, previewBody({ drive_id: "d" }), previewBody({ id: "x" })]) {
      const { res, calls } = await serve(newWorld({ documents: [msRow()], graph: [okPreview()] }), body);
      assertEquals(res.status, 400);
      assertEquals(graphCalls(calls).length, 0);
      assertEquals(dbCalls(calls, "project_documents").length, 0);
    }
  });
});

Deno.test("document-preview AC-003 the shipped handler returns an ephemeral embeddable preview for the caller's own connection", async (t) => {
  await t.step("project document: one POST, exact response keys, no tokens, no-store", async () => {
    const { res, json, calls } = await serve(newWorld({ documents: [msRow()], graph: [okPreview()] }), previewBody());
    assertEquals(res.status, 200);
    assertEquals(Object.keys(json!).sort(), ["get_url", "name"]);
    assertEquals(json, { name: "Plan.pdf", get_url: EMBED });
    assertEquals(res.headers.get("cache-control"), "no-store");
    assertEquals(graphSummary(calls), [`POST ${PREVIEW_PATH}`]);
    assertEquals(graphCalls(calls)[0]!.bodyJson, {});
    const wire = JSON.stringify(json);
    for (const secret of ["access_token", "refresh_token", "downloadUrl", "synthetic-access-token"]) assertFalse(wire.includes(secret), secret);
    // consent is unchanged: nothing wrote to the connection row
    assertEquals(calls.filter((c) => c.url.pathname === "/rest/v1/ms_graph_connections" && c.method !== "GET").length, 0);
  });

  await t.step("every register kind and purchase phase resolves through its own table", async () => {
    const kinds: Array<[Record<string, unknown>, Partial<World>]> = [
      [previewBody({ kind: "procurement_document" }), { documents: [msRow()] }],
      [previewBody({ kind: "budget_link" }), { tables: { budget_version_document_links: [msRow({ source: undefined })] } }],
      [previewBody({ kind: "procurement_file", phase: "receipt" }), { tables: { procurement_receipt_files: [msRow()] } }],
      [previewBody({ kind: "procurement_file", phase: "payment" }), { tables: { payment_files: [msRow()] } }],
      [previewBody({ kind: "procurement_file", phase: "quotation" }), { tables: { procurement_quotation_files: [msRow()] } }],
    ];
    for (const [body, over] of kinds) {
      const { res, json } = await serve(newWorld({ graph: [okPreview()], ...over }), body);
      assertEquals(res.status, 200, JSON.stringify(body));
      assertEquals(json?.get_url, EMBED);
    }
  });

  await t.step("the browser proxy stays GET-only: a POST to the preview path is refused", async () => {
    const { res, calls } = await serve(newWorld({ graph: [okPreview()] }), { action: "graph_proxy", method: "POST", path: PREVIEW_PATH });
    assertEquals(res.status, 400);
    assertEquals(graphCalls(calls).length, 0);
  });
});

Deno.test("document-preview AC-003 a folder child is previewable only as a direct file child of the referenced folder", async (t) => {
  const CHILD = "synthetic-child";
  const childPath = `/drives/${DRIVE}/items/${CHILD}`;
  const folder = () => msRow({ ms_item_kind: "folder" });
  const meta = (over: Record<string, unknown> = {}) => ({
    id: CHILD, name: "Child.docx", webUrl: "https://example.invalid/x", file: {}, parentReference: { driveId: DRIVE, id: REF_ITEM }, ...over,
  });
  const childPreview = gpost(`/drives/${DRIVE}/items/${CHILD}/preview`, () => jsonResponse({ getUrl: EMBED }));
  const body = previewBody({ child_item_id: CHILD });

  await t.step("a direct file child previews, named from Microsoft metadata", async () => {
    const { res, json, calls } = await serve(newWorld({ documents: [folder()], graph: [gget(childPath, () => jsonResponse(meta())), childPreview] }), body);
    assertEquals(res.status, 200);
    assertEquals(json, { name: "Child.docx", get_url: EMBED });
    assertEquals(graphSummary(calls), [`GET ${childPath}`, `POST /drives/${DRIVE}/items/${CHILD}/preview`]);
  });

  const refused: Array<[string, Record<string, unknown>]> = [
    ["parent id differs (a file elsewhere in the library)", meta({ parentReference: { driveId: DRIVE, id: "other-folder" } })],
    ["parent drive differs", meta({ parentReference: { driveId: "other-drive", id: REF_ITEM } })],
    ["the child is a folder", meta({ file: undefined, folder: { childCount: 0 } })],
    ["both facets", meta({ folder: {} })],
    ["no parentReference", meta({ parentReference: undefined })],
    ["malformed parentReference", meta({ parentReference: "x" })],
  ];
  for (const [label, item] of refused) {
    await t.step(`${label} fails closed with no preview POST`, async () => {
      const { res, json, calls } = await serve(newWorld({ documents: [folder()], graph: [gget(childPath, () => jsonResponse(item)), childPreview] }), body);
      assertEquals(res.status, 404);
      assertEquals(json, { error: "SOURCE_NOT_FOUND", message: NOT_AVAILABLE });
      assertFalse(graphSummary(calls).some((line) => line.startsWith("POST")));
    });
  }

  await t.step("metadata 403 is access denied, 404 is the fixed refusal, neither previews", async () => {
    for (const [respond, status, code] of [
      [() => graphError(403, "accessDenied"), 403, "SOURCE_ACCESS_DENIED"],
      [() => graphError(404, "itemNotFound"), 404, "SOURCE_NOT_FOUND"],
    ] as const) {
      const { res, json, calls } = await serve(newWorld({ documents: [folder()], graph: [gget(childPath, respond), childPreview] }), body);
      assertEquals([res.status, json?.error], [status, code]);
      assertFalse(graphSummary(calls).some((line) => line.startsWith("POST")));
    }
  });
});

Deno.test("document-preview AC-004 Microsoft outcomes map to plain recovery codes and only the caller's own connection is read", async (t) => {
  const table: Array<[string, () => Response, number, string]> = [
    ["403", () => graphError(403, "accessDenied"), 403, "SOURCE_ACCESS_DENIED"],
    ["404", () => graphError(404, "itemNotFound"), 404, "SOURCE_NOT_FOUND"],
    ["unsupported", () => graphError(415, "unsupportedMediaType"), 422, "PREVIEW_UNSUPPORTED"],
    ["no embeddable url", () => jsonResponse({ postUrl: EMBED }), 422, "PREVIEW_UNSUPPORTED"],
    ["server error", () => graphError(500, "generalException"), 502, "GRAPH_ERROR"],
  ];
  for (const [label, respond, status, code] of table) {
    await t.step(label, async () => {
      const { res, json } = await serve(newWorld({ documents: [msRow()], graph: [gpost(PREVIEW_PATH, respond)] }), previewBody());
      assertEquals([res.status, json?.error], [status, code]);
      assertFalse(JSON.stringify(json).includes("synthetic upstream text"));
    });
  }

  await t.step("429 carries a capped Retry-After", async () => {
    const { res, json } = await serve(newWorld({ documents: [msRow()], graph: [gpost(PREVIEW_PATH, () => graphError(429, "tooManyRequests", { "Retry-After": "300" }))] }), previewBody());
    assertEquals(res.status, 502);
    assertEquals(json, { error: "GRAPH_ERROR", message: "Graph API request failed", retry_after_seconds: 30 });
    assertEquals(res.headers.get("retry-after"), "30");
  });

  await t.step("connection states", async () => {
    const cases: Array<[Partial<World>, number, string]> = [
      [{ connectionMissing: true }, 404, "NOT_CONNECTED"],
      [{ connectionStatus: "stale" }, 409, "CONNECTION_STALE"],
      [{ connectionStatus: "revoked" }, 410, "CONNECTION_REVOKED"],
      [{ scopes: ["offline_access"] }, 403, "SCOPE_INSUFFICIENT"],
    ];
    for (const [over, status, code] of cases) {
      const { res, json, calls } = await serve(newWorld({ documents: [msRow()], graph: [okPreview()], ...over }), previewBody());
      assertEquals([res.status, json?.error], [status, code]);
      assertEquals(graphCalls(calls).length, 0);
    }
  });

  await t.step("a hung Microsoft call resolves 502 inside the deadline", async () => {
    const time = new FakeTime();
    try {
      await run(newWorld({ documents: [msRow()], graph: [gpost(PREVIEW_PATH, (call) => new Promise<Response>((_r, reject) => call.signal.addEventListener("abort", () => reject(new Error("aborted")))))] }), async (sc) => {
        let settled = false;
        const pending = sc.call(previewBody()).finally(() => (settled = true));
        for (let i = 0; i < 80 && !settled; i += 1) await time.tickAsync(250);
        assert(settled);
        assertEquals((await pending).status, 502);
      });
    } finally {
      time.restore();
    }
  });

  await t.step("the only connection read is the JWT subject's own row", async () => {
    const { calls } = await serve(newWorld({ documents: [msRow()], graph: [okPreview()] }), previewBody());
    const reads = dbCalls(calls, "ms_graph_connections");
    assert(reads.length > 0);
    for (const read of reads) {
      assertEquals(read.url.searchParams.get("user_id"), `eq.${USER}`);
      assertEquals(read.url.searchParams.get("org_id"), `eq.${ORG}`);
    }
  });
});

Deno.test("document-preview AC-003 the preview capability never reaches a log, an error event or an error body", async () => {
  const lines: string[] = [];
  const originals = { error: console.error, log: console.log, warn: console.warn };
  console.error = console.log = console.warn = (...args: unknown[]) => { lines.push(JSON.stringify(args)); };
  const bodies: string[] = [];
  const events: unknown[] = [];
  try {
    const scenarios: Array<[() => Response, Partial<World>]> = [
      [() => jsonResponse({ getUrl: EMBED }), {}],
      [() => graphError(403, "accessDenied"), {}],
      [() => graphError(500, "generalException"), {}],
      [() => graphError(429, "tooManyRequests", { "Retry-After": "5" }), {}],
      [() => jsonResponse({ getUrl: "https://evil.example/e" }), {}],
    ];
    for (const [respond, over] of scenarios) {
      const { json, calls } = await serve(newWorld({ documents: [msRow()], graph: [gpost(PREVIEW_PATH, respond)], ...over }), previewBody());
      bodies.push(JSON.stringify(json));
      for (const c of calls.filter((x) => x.url.pathname === "/rest/v1/error_events")) events.push(c.bodyJson);
    }
  } finally {
    Object.assign(console, originals);
  }
  for (const text of [...lines, ...bodies.slice(1), ...events.map((e) => JSON.stringify(e))]) {
    for (const secret of [EMBED, "embed.aspx", REF_ITEM, "Plan.pdf", "synthetic-access-token", "Bearer", "evil.example"]) assertFalse(text.includes(secret), `${secret} leaked: ${text}`);
  }
  for (const event of events) assertEquals(Object.keys(event as object).sort(), ["context_id", "error_code", "fn", "org_id"]);
});

Deno.test("document-preview AC-003 preview is throttled per user and a pending record read is bounded by the deadline", async (t) => {
  await t.step("the quota answers 429 RATE_LIMITED before any Graph call", async () => {
    const { res, json, calls } = await serve(newWorld({ documents: [msRow()], graph: [okPreview()], rate: () => jsonResponse(false) }), previewBody());
    assertEquals([res.status, json?.error], [429, "RATE_LIMITED"]);
    assertEquals(graphCalls(calls).length, 0);
  });

  await t.step("served preview bounds a pending record read", async () => {
    const time = new FakeTime();
    try {
      await run(newWorld({ hangDocuments: true, graph: [okPreview()] }), async (sc) => {
        // A record read that never answers is released by the request deadline.
        let settled = false;
        const pending = sc.call(previewBody()).finally(() => (settled = true));
        for (let i = 0; i < 60 && !settled; i += 1) await time.tickAsync(250);
        assert(settled, "the request deadline must release a hung record read");
        assertEquals((await pending).status, 502);
      });
    } finally {
      time.restore();
    }
  });
});
