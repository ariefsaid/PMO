// FR-PLN-006: test the shipped compose-view request handler with a verified caller JWT.
import { assertEquals, assert } from "jsr:@std/assert@1.0.0";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";

const SUPABASE_URL = "https://edge-test.supabase.test";
const { handleComposeViewRequest, setTestJwks } = await import("./index.ts");
const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
const publicJwk = await exportJWK(publicKey);
publicJwk.kid = "edge-test-key";
publicJwk.alg = "ES256";
publicJwk.use = "sig";
setTestJwks(createLocalJWKSet({ keys: [publicJwk] }));

async function token(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "ES256", kid: "edge-test-key" })
    .setIssuer(`${SUPABASE_URL}/auth/v1`)
    .setAudience("authenticated")
    .setSubject("synthetic-user")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);
}

async function run(featureEnabled: boolean) {
  const names = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "OPENROUTER_API_KEY"];
  const previous = Object.fromEntries(names.map((name) => [name, Deno.env.get(name)]));
  Deno.env.set("SUPABASE_URL", SUPABASE_URL);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
  Deno.env.set("SUPABASE_ANON_KEY", "synthetic-anon-key");
  Deno.env.delete("OPENROUTER_API_KEY");
  const originalFetch = globalThis.fetch;
  const calls: Array<{ path: string; method: string; body: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const body = request.method === "GET" ? "" : await request.clone().text();
    calls.push({ path: url.pathname, method: request.method, body });
    if (url.pathname === "/rest/v1/profiles") {
      return new Response(JSON.stringify({ org_id: "synthetic-org" }), {
        headers: { "content-type": "application/vnd.pgrst.object+json" },
      });
    }
    if (url.pathname === "/rest/v1/rpc/rate_limit_hit") return Response.json(true);
    if (url.pathname === "/rest/v1/rpc/service_feature_enabled") {
      return Response.json(featureEnabled);
    }
    if (url.pathname === "/rest/v1/error_events") return new Response(null, { status: 201 });
    throw new Error(`unexpected fetch: ${request.method} ${url.pathname}`);
  }) as typeof fetch;
  try {
    const jwt = await token();
    const response = await handleComposeViewRequest(new Request("http://edge.test/compose-view", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: "{",
    }));
    return { response, calls };
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value as string);
    }
  }
}

Deno.test("FR-PLN-006 user_views off refuses before reading the model credential or invoking the model", async () => {
  const { response, calls } = await run(false);
  assertEquals(response.status, 409);
  assertEquals((await response.json()).error, "feature_off");
  assert(calls.some((call) => call.path === "/rest/v1/rpc/service_feature_enabled"));
  assertEquals(calls.some((call) => call.path.includes("openrouter")), false);
});

Deno.test("FR-PLN-006 user_views on proceeds beyond the entitlement precondition", async () => {
  const { response, calls } = await run(true);
  assertEquals(response.status, 400); // malformed JSON is reached after entitlement passes
  assertEquals(calls.filter((call) => call.path === "/rest/v1/rpc/service_feature_enabled").length, 1);
});
