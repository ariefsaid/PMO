// documentPreview.test.ts — `preview_document` (ADR-0095, #1474). Imports the SHIPPED handler and the
// actual exported builder/allowlist; mocks only globalThis.fetch. It is a target of
// scripts/m365-preview-upload-mutation.mjs: break the allowlist or an authorization step and it MUST go red.
import { assert, assertEquals, assertFalse, assertThrows } from "@std/assert";
import { graphCalls, graphError, graphSummary, gpost, makeScenarioRunner, newWorld, READ_SCOPES } from "./recordFolderTestKit.ts";
import { jsonResponse } from "../_shared/testing/edgeTestKit.ts";
import { openCallerDocumentPreview, type DocumentPreviewAccess } from "./graphRead.ts";
import { ERROR_STATUS } from "./types.ts";
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
