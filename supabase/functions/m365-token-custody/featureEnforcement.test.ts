// FR-PLN-006: plan switch enforcement at the shipped M365 handler boundary.
import { assertEquals } from "@std/assert";
import { makeScenarioRunner, newWorld } from "./recordFolderTestKit.ts";

const { handler, setTestJwks } = await import("./index.ts");
const run = makeScenarioRunner(handler, setTestJwks);
const MICROSOFT_ENV = {
  M365_TENANT_ID: "synthetic-tenant",
  M365_CLIENT_ID: "synthetic-client",
  M365_CLIENT_SECRET: "synthetic-secret",
  M365_REDIRECT_URI: "https://example.invalid/callback",
} as const;

async function withMicrosoftEnv<T>(fn: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(Object.keys(MICROSOFT_ENV).map((key) => [key, Deno.env.get(key)]));
  for (const [key, value] of Object.entries(MICROSOFT_ENV)) Deno.env.set(key, value);
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value as string);
    }
  }
}

Deno.test("FR-PLN-006 m365_integration off refuses new consent links before writing PKCE state", async () => {
  await withMicrosoftEnv(() => run(newWorld({ featureEnabled: false }), async ({ call, calls }) => {
    const response = await call({ action: "initiate_connect" });
    assertEquals(response.status, 409);
    assertEquals((await response.json()).error, "feature_off");
    assertEquals(calls.some((call) => call.url.pathname === "/rest/v1/m365_pkce_states"), false);
  }));
});

Deno.test("FR-PLN-006 m365_integration on permits consent link initiation", async () => {
  await withMicrosoftEnv(() => run(newWorld({ featureEnabled: true }), async ({ call, calls }) => {
    const response = await call({ action: "initiate_connect" });
    assertEquals(response.status, 200);
    assertEquals(calls.some((call) => call.url.pathname === "/rest/v1/m365_pkce_states"), true);
  }));
});

Deno.test("FR-PLN-006 m365_integration off still permits disconnect cleanup", async () => {
  await run(newWorld({ featureEnabled: false }), async ({ call, calls }) => {
    const response = await call({ action: "disconnect" });
    assertEquals(response.status, 200);
    assertEquals((await response.json()).success, true);
    assertEquals(calls.some((call) => call.url.pathname === "/rest/v1/rpc/m365_delete_connection"), true);
  });
});
