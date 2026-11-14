import { assert, assertEquals, assertFalse } from "@std/assert";
import { jsonResponse, withFetchMock } from "../_shared/testing/edgeTestKit.ts";
import { handler } from "./index.ts";

const env = {
  SUPABASE_URL: "https://edge-test.supabase.test", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
  M365_TENANT_ID: "synthetic-tenant", M365_CLIENT_ID: "synthetic-client", M365_CLIENT_SECRET: "synthetic-secret",
  M365_REDIRECT_URI: "https://example.invalid/callback", SITE_URL: "https://example.invalid",
  M365_TOKEN_KEK: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
};
const scopes = ["Files.Read", "Files.Read.All", "Sites.Read.All", "Sites.Selected", "offline_access", "openid", "profile"];
const b64 = (v: unknown) => btoa(JSON.stringify(v)).replaceAll("=", "").replaceAll("+", "-").replaceAll("/", "_");
const idToken = `${b64({ alg: "RS256" })}.${b64({ tid: "synthetic-tenant", oid: "synthetic-oid" })}.synthetic`;

async function callbackScenario(payload: Record<string, unknown>, fn: (ctx: {
  call: () => Promise<Response>; calls: import("../_shared/testing/edgeTestKit.ts").FetchCall[];
}) => Promise<void>, featureEnabled = true, apps: unknown[] = []) {
  const old = Object.fromEntries(Object.keys(env).map((k) => [k, Deno.env.get(k)]));
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
  let consumed = false;
  try {
    await withFetchMock([
      { label: "state", method: "DELETE", pathname: "/rest/v1/m365_pkce_states", response: () => {
        if (consumed) return jsonResponse(null);
        consumed = true;
        return jsonResponse({ expires_at: new Date(Date.now() + 60000).toISOString(), code_verifier: "synthetic-verifier", scopes,
          org_id: "synthetic-org", user_id: "synthetic-user" });
      } },
      { label: "app", pathname: "/rest/v1/rpc/m365_org_app_resolve", response: () => jsonResponse(apps) },
      { label: "token", host: "login.microsoftonline.com", response: () => jsonResponse({
        access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600,
        scope: scopes.join(" "), id_token: idToken, ...payload,
      }) },
      { label: "connection", method: "GET", pathname: "/rest/v1/ms_graph_connections", response: () => jsonResponse(null) },
      { label: "membership", pathname: "/rest/v1/rpc/m365_membership_state", response: () => jsonResponse({ state: "active", org_id: "synthetic-org", role: "Project Manager" }) },
      { label: "entitlement", pathname: "/rest/v1/org_features", response: () => jsonResponse({ enabled: true }) },
      { label: "plan-feature", pathname: "/rest/v1/rpc/service_feature_enabled", response: () => jsonResponse(featureEnabled) },
      { label: "save", pathname: "/rest/v1/rpc/m365_upsert_connection", response: () => jsonResponse("synthetic-connection") },
      { label: "audit", pathname: "/rest/v1/rpc/audit_m365_event", response: () => jsonResponse(null) },
      { label: "error", pathname: "/rest/v1/error_events", response: () => jsonResponse(null) },
    ], ({ calls }) => fn({ calls, call: () => handler(new Request("https://edge.test/m365-token-custody/callback?code=synthetic-code&state=synthetic-state")) }));
  } finally {
    for (const [k, v] of Object.entries(old)) { if (v === undefined) Deno.env.delete(k); else Deno.env.set(k, v); }
  }
}

Deno.test("AC-M365DOC-070 served callback validates the token pair before persistence", async () => {
  for (const payload of [{ access_token: null }, { refresh_token: "" }, { expires_in: -1 }, { expires_in: "3600" }]) {
    await callbackScenario(payload, async ({ call, calls }) => {
      const res = await call();
      assert(res.headers.get("location")?.includes("m365_error="));
      assertFalse(calls.some((c) => c.url.pathname.endsWith("/m365_upsert_connection")));
    });
  }
});

Deno.test("AC-M365DOC-070 served callback pins state, identity, granted consent and redirect mode", async () => {
  await callbackScenario({ scope: "Files.Read offline_access" }, async ({ call, calls }) => {
    const first = await call();
    assert(first.headers.get("location")?.includes("m365_connected=true"));
    const save = calls.find((c) => c.url.pathname.endsWith("/m365_upsert_connection"))!;
    assertFalse((save.bodyJson as { p_scopes: string[] }).p_scopes.includes("Sites.Selected"));
    assertEquals(calls.find((c) => c.url.hostname === "login.microsoftonline.com")!.redirect, "error");
    assert((await call()).headers.get("location")?.includes("m365_error="));
    assertEquals(calls.filter((c) => c.url.hostname === "login.microsoftonline.com").length, 1);
  });
  await callbackScenario({ id_token: `${b64({})}.${b64({ tid: "foreign-tenant", oid: "synthetic-oid" })}.x` }, async ({ call, calls }) => {
    assert((await call()).headers.get("location")?.includes("m365_error="));
    assertFalse(calls.some((c) => c.url.pathname.endsWith("/m365_upsert_connection")));
  });
});

Deno.test("FR-PLN-006 callback cannot create a new M365 connection after m365_integration switches off", async () => {
  await callbackScenario({}, async ({ call, calls }) => {
    const response = await call();
    assert(response.headers.get("location")?.includes("m365_error="));
    assertFalse(calls.some((c) => c.url.hostname === "login.microsoftonline.com"));
    assertFalse(calls.some((c) => c.url.pathname.endsWith("/m365_upsert_connection")));
  }, false);
});

Deno.test("AC-M365SS-012 AC-M365SS-013 callback uses the state organization and rejects another directory", async () => {
  const tenant = "11111111-1111-4111-8111-111111111111";
  const app = [{ tenant_id: tenant, client_id: "app-a", client_secret: "secret-a" }];
  for (const tokenTenant of [tenant, "synthetic-tenant"]) {
    const token = `${b64({})}.${b64({ tid: tokenTenant, oid: "synthetic-oid" })}.x`;
    await callbackScenario({ id_token: token }, async ({ call, calls }) => {
      const res = await call();
      const resolve = calls.find((c) => c.url.pathname.endsWith("/m365_org_app_resolve"))!;
      assertEquals(resolve.bodyJson, { p_org_id: "synthetic-org" });
      const exchange = calls.find((c) => c.url.hostname === "login.microsoftonline.com")!;
      assert(exchange.url.pathname.startsWith(`/${tenant}/`));
      const params = new URLSearchParams(String(exchange.bodyText));
      assertEquals(params.get("client_id"), "app-a");
      assertEquals(params.get("client_secret"), "secret-a");
      assertEquals(calls.some((c) => c.url.pathname.endsWith("/m365_upsert_connection")), tokenTenant === tenant);
      assert(res.headers.get("location")?.includes(tokenTenant === tenant ? "m365_connected=true" : "m365_error="));
    }, true, app);
  }
});

Deno.test("callback records an application resolution error once", async () => {
  await callbackScenario({}, async ({ call, calls }) => {
    const response = await call();
    assert(response.headers.get("location")?.includes("m365_error="));
    const events = calls.filter((c) => c.url.pathname === "/rest/v1/error_events");
    assertEquals(events.length, 1);
    assertEquals((events[0].bodyJson as Record<string, unknown>).error_code, "APP_RESOLUTION_FAILED");
    const event = JSON.stringify(events[0].bodyJson);
    for (const value of ["synthetic-secret", "synthetic-access", "synthetic-refresh", "synthetic-code"]) assertFalse(event.includes(value));
    assertFalse(calls.some((c) => c.url.hostname === "login.microsoftonline.com"));
  }, true, [{}]);
});
