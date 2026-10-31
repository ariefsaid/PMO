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
import { makeScenarioRunner } from "./recordFolderTestKit.ts";
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
