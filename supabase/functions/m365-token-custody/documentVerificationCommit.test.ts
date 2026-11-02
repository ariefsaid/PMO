import { encryptToken, serializeEnvelope } from "./crypto.ts";
import {
  createJwtAuthority,
  createTestJwksResolver,
  jsonResponse,
  supabaseRpc,
  supabaseSelect,
  withFetchMock,
} from "../_shared/testing/edgeTestKit.ts";

const originalServe = Deno.serve;
Deno.serve = (() => undefined) as unknown as typeof Deno.serve;
const { handler, setTestJwks } = await import("./index.ts");
Deno.serve = originalServe;

const DOC_A = "10200000-0000-0000-0000-000000000301";
const DOC_B = "10200000-0000-0000-0000-000000000302";

/** Serve check_documents for two claimed documents whose Graph reads succeed; `commit` answers the commit RPC. */
async function runCheck(commit: (docId: string) => Response) {
  const url = "https://edge-test.supabase.test";
  const auth = await createJwtAuthority(url);
  const token = await auth.mintJwt({ sub: "synthetic-verified-user" });
  setTestJwks(createTestJwksResolver(auth));
  const names = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "M365_TOKEN_KEK"] as const;
  const previous = Object.fromEntries(names.map((n) => [n, Deno.env.get(n)]));
  const rawKek = new Uint8Array(32).fill(9);
  const kek = btoa(String.fromCharCode(...rawKek)).replace(/=/g, "").replaceAll("+", "-").replaceAll("/", "_");
  Deno.env.set("SUPABASE_URL", url);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
  Deno.env.set("SUPABASE_ANON_KEY", "synthetic-anon-key");
  Deno.env.set("M365_TOKEN_KEK", kek);
  try {
    const encrypted = await encryptToken("synthetic-access-token", rawKek);
    const connection = {
      id: "synthetic-connection", org_id: "synthetic-org", user_id: "synthetic-verified-user",
      entra_tenant_id: "synthetic-tenant", entra_user_object_id: null, scopes: ["Files.Read"],
      refresh_token_ciphertext: "\\x00",
      access_token_ciphertext: `\\x${Array.from(serializeEnvelope(encrypted.iv, encrypted.ciphertext), (b) => b.toString(16).padStart(2, "0")).join("")}`,
      access_token_expires_at: new Date(Date.now() + 3600000).toISOString(), refresh_token_expires_at: null,
      key_id: "kek-v1", status: "active", connected_at: new Date().toISOString(), last_refresh_at: null,
      updated_at: new Date().toISOString(),
    };
    const claimed = (id: string, k: string) => ({
      id, ms_drive_id: `drive-${k}`, ms_item_id: `item-${k}`, ms_content_tag_at_issue: `tag-${k}`, ms_check_claim: `claim-${k}`,
    });
    const item = (k: string) => ({
      id: String(k === "a" ? 1 : 2), status: 200,
      body: { id: `item-${k}`, name: `Evidence ${k}`, webUrl: `https://tenant.sharepoint.com/${k}`, cTag: `tag-${k}`, parentReference: { driveId: `drive-${k}` }, file: {} },
    });
    let out: { status: number; body: { checked: number; uncommitted?: number } } | null = null;
    await withFetchMock([
      supabaseRpc("m365_membership_state", () => jsonResponse({ state: "active", org_id: "synthetic-org", role: "Finance" })),
      supabaseSelect("org_features", () => jsonResponse({ enabled: true }, { headers: { "content-type": "application/vnd.pgrst.object+json" } })),
      supabaseRpc("m365_claim_document_checks", () => jsonResponse([claimed(DOC_A, "a"), claimed(DOC_B, "b")])),
      supabaseSelect("ms_graph_connections", () => jsonResponse(connection, { headers: { "content-type": "application/vnd.pgrst.object+json" } })),
      { label: "graph-batch", host: "graph.microsoft.com", pathname: "/v1.0/$batch", method: "POST", response: () => jsonResponse({ responses: [item("a"), item("b")] }) },
      supabaseRpc("m365_commit_document_check", (call) => commit((call.bodyJson as { p_doc_id: string }).p_doc_id)),
    ], async () => {
      const response = await handler(new Request("http://edge.test/m365-token-custody", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check_documents", document_ids: [DOC_A, DOC_B] }),
      }));
      out = { status: response.status, body: await response.json() };
    });
    return out!;
  } finally {
    for (const n of names) {
      const v = previous[n];
      if (v === undefined) Deno.env.delete(n);
      else Deno.env.set(n, v);
    }
  }
}

Deno.test("AC-M365DOC-064 check_documents counts only checks whose commit wrote (a superseded commit is not verified)", async () => {
  const r = await runCheck((id) => jsonResponse(id === DOC_A));
  if (r.status !== 200 || r.body.checked !== 1 || r.body.uncommitted !== 1) {
    throw new Error(`superseded commit counted as verified: ${JSON.stringify(r)}`);
  }
});

Deno.test("AC-M365DOC-064 check_documents does not count a check whose commit RPC errored", async () => {
  const r = await runCheck((id) =>
    id === DOC_A ? jsonResponse(true) : jsonResponse({ code: "XX000", message: "db down" }, { status: 500 })
  );
  if (r.status !== 200 || r.body.checked !== 1 || r.body.uncommitted !== 1) {
    throw new Error(`failed commit counted as verified: ${JSON.stringify(r)}`);
  }
});

Deno.test("AC-M365DOC-064 check_documents reports every check when all commits wrote", async () => {
  const r = await runCheck(() => jsonResponse(true));
  if (r.body.checked !== 2 || r.body.uncommitted !== 0) throw new Error(JSON.stringify(r));
});
