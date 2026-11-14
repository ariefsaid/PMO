import { assert, assertEquals } from "@std/assert";
import { makeScenarioRunner, newWorld, rpcBodies } from "./recordFolderTestKit.ts";

const { handler, setTestJwks } = await import("./index.ts");
const run = makeScenarioRunner(handler, setTestJwks);

Deno.test("AC-M365SS-010: a non-Admin cannot manage organization app values", async () => {
  await run(newWorld({ role: "Project Manager" }), async ({ call }) => {
    for (const action of ["save_org_app", "org_app_info", "clear_org_app"]) {
      const response = await call({ action });
      assertEquals(response.status, 403);
    }
  });
});

Deno.test("AC-M365SS-012: connect uses each caller organization's app", async () => {
  const apps = {
    "org-a": [{ tenant_id: "11111111-1111-4111-8111-111111111111", client_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", client_secret: "synthetic-a" }],
    "org-b": [{ tenant_id: "22222222-2222-4222-8222-222222222222", client_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", client_secret: "synthetic-b" }],
  };
  for (const orgId of ["org-a", "org-b"] as const) {
    await run(newWorld({ orgId, appRows: apps }), async ({ call, calls }) => {
      const response = await call({ action: "initiate_connect" });
      assertEquals(response.status, 200);
      const url = new URL((await response.json()).authorizeUrl);
      assertEquals(url.pathname.startsWith(`/${apps[orgId][0].tenant_id}/`), true);
      assertEquals(url.searchParams.get("client_id"), apps[orgId][0].client_id);
      assertEquals(rpcBodies(calls, "m365_org_app_resolve"), [{ p_org_id: orgId }]);
    });
  }
});

Deno.test("AC-M365SS-012 approval uses the caller organization's app", async () => {
  const app = { tenant_id: "11111111-1111-4111-8111-111111111111", client_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", client_secret: "synthetic-a" };
  await run(newWorld({ role: "Admin", orgId: "org-a", appRows: { "org-a": [app] } }), async ({ call, calls }) => {
    const response = await call({ action: "initiate_org_approval", tenantId: "untrusted" });
    assertEquals(response.status, 200);
    const url = new URL((await response.json()).adminConsentUrl);
    assertEquals(url.pathname.startsWith(`/${app.tenant_id}/`), true);
    assertEquals(url.searchParams.get("client_id"), app.client_id);
    assertEquals(rpcBodies(calls, "m365_org_app_resolve"), [{ p_org_id: "org-a" }]);
  });
});

Deno.test("AC-M365SS-012 refresh and revoke use the organization's app", async () => {
  const app = { tenant_id: "11111111-1111-4111-8111-111111111111", client_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", client_secret: "synthetic-a" };
  for (const action of ["graph_proxy", "disconnect"]) {
    await run(newWorld({ orgId: "org-a", appRows: { "org-a": [app] }, connectionTenant: app.tenant_id, accessExpired: true }), async ({ call, calls }) => {
      await call(action === "graph_proxy" ? { action, method: "GET", path: "/me/drive" } : { action });
      const token = calls.find((c) => c.url.hostname === "login.microsoftonline.com")!;
      assertEquals(token.url.pathname.startsWith(`/${app.tenant_id}/`), true);
      const params = new URLSearchParams(token.bodyText);
      assertEquals(params.get("client_id"), app.client_id);
      assertEquals(params.get("client_secret"), app.client_secret);
      assertEquals(rpcBodies(calls, "m365_org_app_resolve"), [{ p_org_id: "org-a" }]);
    });
  }
});

Deno.test("AC-M365SS-016 AC-M365SS-011 Admin validates before storing and info never reveals secret material or a timestamp", async () => {
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const clientId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const clientSecret = "synthetic-confidential";
  const app = { tenant_id: tenantId, client_id: clientId, client_secret: clientSecret };
  await run(newWorld({ role: "Admin", orgId: "org-b", appRows: { "org-a": [{ tenant_id: "22222222-2222-4222-8222-222222222222", client_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", client_secret: "other-secret" }], "org-b": [app] } }), async ({ call, calls }) => {
    const save = await call({ action: "save_org_app", tenantId, clientId, clientSecret, orgId: "org-a" });
    assertEquals(save.status, 200);
    assert(!JSON.stringify(await save.json()).includes(clientSecret));
    const microsoft = calls.findIndex((c) => c.url.hostname === "login.microsoftonline.com");
    const write = calls.findIndex((c) => c.url.pathname.endsWith("/m365_set_org_app"));
    assert(microsoft >= 0 && write > microsoft);
    assertEquals(rpcBodies(calls, "m365_set_org_app")[0].p_org_id, "org-b");
    const info = await call({ action: "org_app_info", orgId: "org-a" });
    assertEquals(info.status, 200);
    const text = await info.text();
    const data = JSON.parse(text);
    assertEquals(data.secretSet, true);
    assertEquals(data.tenantId, tenantId);
    assertEquals(data.clientId, clientId);
    assertEquals(rpcBodies(calls, "m365_org_app_resolve").at(-1), { p_org_id: "org-b" });
    assertEquals("validatedAt" in data, false);
    assert(!text.includes(clientSecret));
    assert(!text.includes("secret_ref"));
    const clear = await call({ action: "clear_org_app", orgId: "org-a" });
    assertEquals(clear.status, 200);
    assertEquals(rpcBodies(calls, "m365_clear_org_app")[0].p_org_id, "org-b");
  });
});

Deno.test("AC-M365SS-009 invalid credentials or unreachable Microsoft never store values", async () => {
  const valid = { action: "save_org_app", tenantId: "11111111-1111-4111-8111-111111111111", clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", clientSecret: "synthetic-secret" };
  for (const mode of ["invalid", "unreachable", "malformed"]) {
    await run(newWorld({ role: "Admin", refresh: () => { if (mode === "unreachable") throw new Error("offline"); return new Response(JSON.stringify({ error: "invalid_client" }), { status: 400 }); } }), async ({ call, calls }) => {
      const response = await call(mode === "malformed" ? { ...valid, tenantId: "bad" } : valid);
      assertEquals(response.status, mode === "invalid" ? 422 : mode === "unreachable" ? 502 : 400);
      assertEquals(rpcBodies(calls, "m365_set_org_app").length, 0);
      if (mode === "malformed") assertEquals(calls.filter((c) => c.url.hostname === "login.microsoftonline.com").length, 0);
    });
  }
});

Deno.test("AC-M365SS-014 AC-M365SS-015 absent app uses deployment or refuses before storing state", async () => {
  for (const noDeployment of [false, true]) {
    await run(newWorld({ role: "Admin", noDeployment }), async ({ call, calls }) => {
      for (const action of ["initiate_connect", "initiate_org_approval"]) {
        const response = await call({ action });
        if (noDeployment) {
          assertEquals(response.status, 409);
          assertEquals((await response.json()).error, "M365_APP_NOT_CONFIGURED");
        } else {
          assertEquals(response.status, 200);
          const data = await response.json();
          const url = new URL(data.authorizeUrl ?? data.adminConsentUrl);
          assert(url.pathname.startsWith('/synthetic-tenant/'));
          assertEquals(url.searchParams.get('client_id'), 'synthetic-client');
        }
      }
      if (noDeployment) assertEquals(calls.filter((c) => c.url.pathname === '/rest/v1/m365_pkce_states').length, 0);
    });
  }
});

Deno.test("AC-M365SS-014 refresh and revoke fall back to deployment app", async () => {
  for (const action of ["graph_proxy", "disconnect"]) {
    await run(newWorld({ accessExpired: true }), async ({ call, calls }) => {
      await call(action === "graph_proxy" ? { action, method: "GET", path: "/me/drive" } : { action });
      const token = calls.find((c) => c.url.hostname === "login.microsoftonline.com")!;
      assert(token.url.pathname.startsWith("/synthetic-tenant/"));
      const params = new URLSearchParams(token.bodyText);
      assertEquals(params.get("client_id"), "synthetic-client");
      assertEquals(params.get("client_secret"), "synthetic-secret");
    });
  }
});

Deno.test("AC-M365SS-009 editing without a secret validates with the existing organization secret", async () => {
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const clientId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await run(newWorld({ role: "Admin", orgId: "org-a", appRows: { "org-a": [{ tenant_id: tenantId, client_id: clientId, client_secret: "synthetic-existing" }] } }), async ({ call, calls }) => {
    const result = await call({ action: "save_org_app", tenantId, clientId });
    assertEquals(result.status, 200);
    const request = calls.find((c) => c.url.hostname === "login.microsoftonline.com")!;
    assertEquals(new URLSearchParams(request.bodyText).get("client_secret"), "synthetic-existing");
    assertEquals(rpcBodies(calls, "m365_set_org_app")[0].p_secret_value, null);
  });
});

Deno.test("AC-M365SS-009 Microsoft rejects unknown directories and unauthorized applications without a write", async () => {
  const values = { action: "save_org_app", tenantId: "11111111-1111-4111-8111-111111111111", clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", clientSecret: "synthetic-secret" };
  for (const [payload, expected] of [
    [{ error: "invalid_request", error_codes: [90002] }, "TENANT_REJECTED"],
    [{ error: "unauthorized_client" }, "APP_REJECTED"],
  ] as const) {
    await run(newWorld({ role: "Admin", refresh: () => new Response(JSON.stringify(payload), { status: 400 }) }), async ({ call, calls }) => {
      const response = await call(values);
      assertEquals(response.status, 422);
      assertEquals((await response.json()).error, expected);
      assertEquals(rpcBodies(calls, "m365_set_org_app").length, 0);
    });
  }
});

Deno.test("organization app info reports only organization-owned values", async () => {
  await run(newWorld({ role: "Admin" }), async ({ call }) => {
    const response = await call({ action: "org_app_info" });
    assertEquals(response.status, 200);
    const text = await response.text();
    const data = JSON.parse(text);
    assertEquals(data.configured, false);
    assertEquals(data.source, "deployment");
    assertEquals(data.tenantId, null);
    assertEquals(data.clientId, null);
    assertEquals(data.secretSet, false);
    assert(data.callbackUrls.connect);
    assert(data.callbackUrls.signIn);
    assert(!text.includes("synthetic-tenant"));
    assert(!text.includes("synthetic-client"));
  });
});

Deno.test("application validation classifies rejected and unavailable responses", async () => {
  const values = { action: "save_org_app", tenantId: "11111111-1111-4111-8111-111111111111", clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", clientSecret: "synthetic-secret" };
  const cases: Array<[() => Response, number, string]> = [
    [() => new Response(JSON.stringify({ error: "invalid_scope" }), { status: 400 }), 422, "APP_REJECTED"],
    [() => new Response(JSON.stringify({ error: "invalid_client" }), { status: 503 }), 502, "MICROSOFT_UNREACHABLE"],
    [() => new Response("not json", { status: 400 }), 502, "MICROSOFT_UNREACHABLE"],
    [() => { throw new DOMException("timeout", "AbortError"); }, 502, "MICROSOFT_UNREACHABLE"],
    [() => { throw new Error("offline"); }, 502, "MICROSOFT_UNREACHABLE"],
  ];
  for (const [refresh, status, error] of cases) {
    await run(newWorld({ role: "Admin", refresh }), async ({ call, calls }) => {
      const response = await call(values);
      assertEquals(response.status, status);
      assertEquals((await response.json()).error, error);
      assertEquals(rpcBodies(calls, "m365_set_org_app").length, 0);
    });
  }
});

Deno.test("application saves are bounded per user", async () => {
  let attempts = 0;
  const values = { action: "save_org_app", tenantId: "11111111-1111-4111-8111-111111111111", clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", clientSecret: "synthetic-secret" };
  await run(newWorld({ role: "Admin", rate: () => new Response(JSON.stringify(++attempts <= 5), { headers: { "Content-Type": "application/json" } }) }), async ({ call, calls }) => {
    for (let i = 0; i < 5; i++) assertEquals((await call(values)).status, 200);
    const beforeMicrosoft = calls.filter((c) => c.url.hostname === "login.microsoftonline.com").length;
    const beforeWrites = rpcBodies(calls, "m365_set_org_app").length;
    const response = await call(values);
    assertEquals(response.status, 429);
    assertEquals((await response.json()).error, "RATE_LIMITED");
    assertEquals(response.headers.get("Retry-After"), "60");
    assertEquals(calls.filter((c) => c.url.hostname === "login.microsoftonline.com").length, beforeMicrosoft);
    assertEquals(rpcBodies(calls, "m365_set_org_app").length, beforeWrites);
    const rates = rpcBodies(calls, "rate_limit_hit");
    assertEquals(rates.length, 6);
    assertEquals(rates[0].p_limit, 5);
    assertEquals(rates[0].p_window_secs, 60);
    assert(String(rates[0].p_key).includes("save_org_app"));
  });
});
