import { assertEquals } from "jsr:@std/assert@1";
import { PROC_FILE_PHASES, validPreviewEmbedUrl } from "./microsoftDocumentPreview.ts";

Deno.test("document-preview AC-003 validPreviewEmbedUrl accepts https Microsoft hosts only", () => {
  assertEquals(validPreviewEmbedUrl("https://synthetic.sharepoint.com/sites/x/_layouts/15/embed.aspx?a=b"), true);
  assertEquals(validPreviewEmbedUrl("https://view.officeapps.live.com/op/embed.aspx?x=1"), true);
  for (
    const bad of [
      "http://synthetic.sharepoint.com/x",
      "https://evil.example/",
      "https://sharepoint.com.evil.example/",
      "https://evilsharepoint.com/",
      "https://user:pw@synthetic.sharepoint.com/x",
      "https://synthetic.sharepoint.com/x\u0000y",
      "https://synthetic.sharepoint.com/x\ny",
      "",
      42,
      null,
      undefined,
      {},
    ]
  ) assertEquals(validPreviewEmbedUrl(bad), false, String(bad));
});

Deno.test("document-preview AC-003 procurement file phases cover the seven attachment tables", () => {
  assertEquals(PROC_FILE_PHASES.length, 7);
});
