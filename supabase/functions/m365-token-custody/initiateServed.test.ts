// initiateServed.test.ts — the SERVED handler passes the request body's `folders` flag through to initiate.
// Imports the shipped handler from ./index.ts; mocks only globalThis.fetch (PostgREST boundary).
import { assert, assertEquals, assertFalse } from "@std/assert";
import { makeScenarioRunner, newWorld } from "./recordFolderTestKit.ts";

const { handler, setTestJwks } = await import("./index.ts");
const run = makeScenarioRunner(handler, setTestJwks);

const ENV = {
  M365_TENANT_ID: "synthetic-tenant", M365_CLIENT_ID: "synthetic-client", M365_CLIENT_SECRET: "synthetic-secret",
  M365_REDIRECT_URI: "https://example.invalid/callback",
} as const;

async function withMicrosoftEnv<T>(fn: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(Object.keys(ENV).map((name) => [name, Deno.env.get(name)]));
  for (const [name, value] of Object.entries(ENV)) Deno.env.set(name, value);
  try {
    return await fn();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value as string);
    }
  }
}

const scopeOf = (authorizeUrl: string) => new URL(authorizeUrl).searchParams.get("scope") ?? "";

Deno.test("AC-M365DOC-070 served initiate_connect: body folders:true requests Sites.Selected; absent or false does not", async (t) => {
  await t.step("folders:true => the authorize URL carries Sites.Selected and the stored state records it", async () => {
    await withMicrosoftEnv(() => run(newWorld(), async ({ call, calls }) => {
      const res = await call({ action: "initiate_connect", folders: true });
      assertEquals(res.status, 200);
      assert(scopeOf((await res.json()).authorizeUrl).includes("Sites.Selected"));
      const stored = calls.find((c) => c.url.pathname === "/rest/v1/m365_pkce_states");
      assert((stored?.bodyJson as { scopes: string[] }).scopes.includes("Sites.Selected"));
    }));
  });
  await t.step("no folders key => read-only scopes", async () => {
    await withMicrosoftEnv(() => run(newWorld(), async ({ call }) => {
      const res = await call({ action: "initiate_connect" });
      assertEquals(res.status, 200);
      assertFalse(scopeOf((await res.json()).authorizeUrl).includes("Sites.Selected"));
    }));
  });
  await t.step("folders:false is refused by the strict body", async () => {
    await withMicrosoftEnv(() => run(newWorld(), async ({ call }) => {
      assertEquals((await call({ action: "initiate_connect", folders: false })).status, 400);
    }));
  });
});
