import { readDocumentMetadataBatch } from "./documentReadBatch.ts";
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

Deno.test("AC-M365DOC-064 builds bounded metadata-only batch reads with server IDs", async () => {
  let captured: Array<{ id: string; method: "GET"; url: string }> = [];
  const session = {
    get: async () => ({ status: 500 }),
    batch: async (
      entries: Array<{ id: string; method: "GET"; url: string }>,
    ) => {
      captured = entries;
      return { status: 200, body: { responses: [] } };
    },
  };
  await readDocumentMetadataBatch(session, [
    { drive_id: "synthetic-drive-a", item_id: "synthetic-item-a" },
    { drive_id: "synthetic-drive-b", item_id: "synthetic-item-b" },
  ]);
  if (
    captured.length !== 2 || captured[0]?.id !== "1" || captured[1]?.id !== "2"
  ) {
    throw new Error("batch IDs must be unique and server generated");
  }
  for (const entry of captured) {
    if (
      !entry.url.startsWith("/drives/") ||
      !entry.url.includes(
        "?$select=id,name,webUrl,parentReference,file,folder,cTag,sharepointIds",
      )
    ) {
      throw new Error(
        "batch child must use the fixed metadata-only projection",
      );
    }
    if (
      Object.keys(entry).sort().join(",") !== "id,method,url" ||
      entry.method !== "GET"
    ) {
      throw new Error(
        "batch child cannot carry method, body, headers, or dependencies",
      );
    }
    if (/content|children|versions|PATCH|DELETE|POST/i.test(entry.url)) {
      throw new Error("batch child escaped the metadata item read route");
    }
  }
  let oversizedCall = false;
  await readDocumentMetadataBatch(
    {
      ...session,
      batch: async () => {
        oversizedCall = true;
        return { status: 200 };
      },
    },
    Array.from({ length: 21 }, (_, index) => ({
      drive_id: `synthetic-drive-${index}`,
      item_id: `synthetic-item-${index}`,
    })),
  );
  if (oversizedCall) {
    throw new Error("batch must reject more than twenty entries");
  }
});

Deno.test("AC-M365DOC-064 served check_documents rejects over-limit IDs before claim or Graph access", async () => {
  const url = "https://edge-test.supabase.test";
  const auth = await createJwtAuthority(url);
  const token = await auth.mintJwt({ sub: "synthetic-user" });
  setTestJwks(createTestJwksResolver(auth));
  const names = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
  ] as const;
  const previous = Object.fromEntries(
    names.map((name) => [name, Deno.env.get(name)]),
  );
  Deno.env.set("SUPABASE_URL", url);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
  Deno.env.set("SUPABASE_ANON_KEY", "synthetic-anon-key");
  try {
    const response = await handler(
      new Request("http://edge.test/m365-token-custody", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "check_documents",
          document_ids: Array.from(
            { length: 21 },
            (_, index) =>
              `10200000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
          ),
        }),
      }),
    );
    const body = await response.json();
    if (
      response.status !== 400 ||
      body.message !== "Cannot check these documents."
    ) {
      throw new Error(
        "served check_documents must reject oversized requests safely",
      );
    }
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});

Deno.test("AC-M365DOC-064 served checks fence inactive callers and use only verified actor IDs", async () => {
  const url = "https://edge-test.supabase.test";
  const auth = await createJwtAuthority(url);
  const token = await auth.mintJwt({ sub: "synthetic-verified-user" });
  setTestJwks(createTestJwksResolver(auth));
  const names = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
  ] as const;
  const previous = Object.fromEntries(
    names.map((name) => [name, Deno.env.get(name)]),
  );
  Deno.env.set("SUPABASE_URL", url);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
  Deno.env.set("SUPABASE_ANON_KEY", "synthetic-anon-key");
  try {
    await withFetchMock([
      supabaseRpc("m365_membership_state", () =>
        jsonResponse({
          state: "disabled",
          org_id: "synthetic-org-a",
          role: "Admin",
        })),
    ], async ({ calls }) => {
      const response = await handler(
        new Request("http://edge.test/m365-token-custody", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "check_documents",
            document_ids: ["10200000-0000-0000-0000-000000000301"],
          }),
        }),
      );
      if (response.status !== 403) {
        throw new Error(`inactive caller was not rejected: ${response.status}`);
      }
      if (calls.some((call) => call.url.pathname.includes("m365_claim_document_checks"))) {
        throw new Error("inactive caller reached the claim RPC");
      }
    });

    await withFetchMock([
      supabaseRpc("m365_membership_state", (call) => {
        if ((call.bodyJson as { p_user_id?: string })?.p_user_id !== "synthetic-verified-user") {
          throw new Error("membership lookup did not use the verified JWT subject");
        }
        return jsonResponse({
          state: "active",
          org_id: "synthetic-org-a",
          role: "Finance",
        });
      }),
      supabaseSelect("org_features", () =>
        jsonResponse({ enabled: true }, {
          headers: { "content-type": "application/vnd.pgrst.object+json" },
        })),
      supabaseRpc("m365_claim_document_checks", (call) => {
        const payload = call.bodyJson as Record<string, unknown>;
        if (payload.p_actor_id !== "synthetic-verified-user") {
          throw new Error("claim RPC actor was not server-derived from the JWT");
        }
        if (payload.p_ids === undefined || "p_baseline" in payload || "p_content_tag" in payload) {
          throw new Error("client supplied baseline or content entered the claim RPC");
        }
        return jsonResponse([]);
      }),
    ], async ({ calls }) => {
      const response = await handler(
        new Request("http://edge.test/m365-token-custody", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "check_documents",
            document_ids: ["10200000-0000-0000-0000-000000000301"],
            actor_id: "synthetic-forged-user",
            org_id: "synthetic-org-b",
            baseline: "synthetic-client-baseline",
            cTag: "synthetic-client-content-tag",
            batch: [{ method: "POST", url: "/me/drive/root/children", body: "write" }],
          }),
        }),
      );
      const body = await response.json();
      if (response.status !== 200 || body.checked !== 0) {
        throw new Error("unclaimed or cross-org references were not safely withheld");
      }
      if (calls.some((call) => call.url.origin === "https://graph.microsoft.com")) {
        throw new Error("untrusted client baseline or nested write reached Graph");
      }
    });
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});

Deno.test("AC-M365DOC-056 served handler preserves metadata-only preflight behavior", async () => {
  const response = await handler(
    new Request("http://edge.test/m365-token-custody", { method: "OPTIONS" }),
  );
  if (response.status !== 200 || await response.text() !== "ok") {
    throw new Error("unexpected preflight response");
  }
});

Deno.test("AC-M365DOC-056 served handler enforces consented scopes on graph_proxy", async () => {
  const url = "https://edge-test.supabase.test";
  const auth = await createJwtAuthority(url);
  const token = await auth.mintJwt({ sub: "synthetic-user" });
  setTestJwks(createTestJwksResolver(auth));
  const names = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
  ] as const;
  const previous = Object.fromEntries(
    names.map((name) => [name, Deno.env.get(name)]),
  );
  Deno.env.set("SUPABASE_URL", url);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
  Deno.env.set("SUPABASE_ANON_KEY", "synthetic-anon-key");
  try {
    await withFetchMock([
      supabaseRpc("m365_membership_state", () =>
        jsonResponse({
          state: "active",
          org_id: "synthetic-org",
          role: "Admin",
        })),
      supabaseSelect("org_features", () =>
        jsonResponse({ enabled: true }, {
          headers: { "content-type": "application/vnd.pgrst.object+json" },
        })),
      supabaseSelect("ms_graph_connections", () =>
        jsonResponse({
          id: "synthetic-connection",
          status: "active",
          scopes: ["Files.Read"],
        }, {
          headers: { "content-type": "application/vnd.pgrst.object+json" },
        })),
    ], async () => {
      const response = await handler(
        new Request("http://edge.test/m365-token-custody", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "graph_proxy",
            method: "POST",
            path: "/me/drive/root/children",
          }),
        }),
      );
      if (response.status !== 403) {
        throw new Error(`expected scope rejection, got ${response.status}`);
      }
      const result = await response.json();
      if (result.error !== "SCOPE_INSUFFICIENT") {
        throw new Error("expected scope rejection envelope");
      }
    });
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});

Deno.test("AC-M365DOC-056 served graph_proxy keeps its caller-scoped connection error envelope", async () => {
  const url = "https://edge-test.supabase.test";
  const auth = await createJwtAuthority(url);
  const token = await auth.mintJwt({ sub: "synthetic-user" });
  setTestJwks(createTestJwksResolver(auth));
  const names = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
  ] as const;
  const previous = Object.fromEntries(
    names.map((name) => [name, Deno.env.get(name)]),
  );
  for (const name of names) {
    Deno.env.set(
      name,
      name === "SUPABASE_URL" ? url : `synthetic-${name.toLowerCase()}`,
    );
  }
  try {
    await withFetchMock([
      supabaseRpc("m365_membership_state", () =>
        jsonResponse({
          state: "active",
          org_id: "synthetic-org",
          role: "Admin",
        })),
      supabaseSelect("org_features", () =>
        jsonResponse({ enabled: true }, {
          headers: { "content-type": "application/vnd.pgrst.object+json" },
        })),
      supabaseSelect(
        "ms_graph_connections",
        () => jsonResponse({ message: "not found" }, { status: 406 }),
      ),
    ], async ({ calls }) => {
      const response = await handler(
        new Request("http://edge.test/m365-token-custody", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "graph_proxy",
            method: "GET",
            path: "/me/drive",
          }),
        }),
      );
      const body = await response.json();
      if (response.status !== 404 || body.error !== "NOT_CONNECTED") {
        throw new Error("graph_proxy connection failure response changed");
      }
      if (
        calls.some((call) => call.url.origin === "https://graph.microsoft.com")
      ) {
        throw new Error("Graph was called without a caller connection");
      }
    });
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});

Deno.test("AC-M365DOC-056 served handler authenticates before parsing proxy JSON", async () => {
  const names = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
  ] as const;
  const previous = Object.fromEntries(
    names.map((name) => [name, Deno.env.get(name)]),
  );
  try {
    Deno.env.set("SUPABASE_URL", "https://edge-test.supabase.test");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
    Deno.env.set("SUPABASE_ANON_KEY", "synthetic-anon-key");
    const response = await handler(
      new Request("http://edge.test/m365-token-custody", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    );
    if (response.status !== 401) {
      throw new Error(`expected 401, got ${response.status}`);
    }
    const body = await response.json();
    if (body.error !== "UNAUTHORIZED") {
      throw new Error("expected stable unauthorized response");
    }
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});
