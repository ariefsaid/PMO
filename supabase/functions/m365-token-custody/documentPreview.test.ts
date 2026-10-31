// documentPreview.test.ts — `preview_document` (ADR-0095, #1474). Imports the SHIPPED handler and the
// actual exported builder/allowlist; mocks only globalThis.fetch. It is a target of
// scripts/m365-preview-upload-mutation.mjs: break the allowlist or an authorization step and it MUST go red.
import { assert, assertEquals, assertFalse, assertThrows } from "@std/assert";
import { makeScenarioRunner } from "./recordFolderTestKit.ts";
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
