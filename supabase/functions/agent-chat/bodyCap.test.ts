// agent-chat request-body cap [Deno unit] — the shipped request handler reads the body through
// the stream-bounded reader and answers 413 PAYLOAD_TOO_LARGE once it exceeds
// MAX_REQUEST_BODY_BYTES, whether or not the request declares a Content-Length. Proven against the
// REAL shipped entrypoint (import ./index.ts, mocked globalThis.fetch, real JWT verification).
//
// Verify: cd supabase/functions/agent-chat && deno test -A bodyCap.test.ts
import { assertEquals } from "jsr:@std/assert@1.0.0";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";

const SUPABASE_URL = "https://edge-test.supabase.test";
const { handleAgentChatRequest, setTestJwks, MAX_REQUEST_BODY_BYTES } = await import("./index.ts");
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

/** A well-formed agent-chat request (one long user message) whose serialized size is at least `bytes`. */
function bodyOfSize(bytes: number): string {
  return JSON.stringify({ messages: [{ role: "user", content: "x".repeat(bytes) }] });
}

/** The same bytes as a stream, so the request carries no Content-Length. */
function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  const chunk = 4096;
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + chunk));
      offset += chunk;
    },
  });
}

async function send(body: BodyInit) {
  const names = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "OPENROUTER_API_KEY"];
  const previous = Object.fromEntries(names.map((name) => [name, Deno.env.get(name)]));
  Deno.env.set("SUPABASE_URL", SUPABASE_URL);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
  Deno.env.set("SUPABASE_ANON_KEY", "synthetic-anon-key");
  Deno.env.set("OPENROUTER_API_KEY", "synthetic-model-key");
  const originalFetch = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    paths.push(url.pathname);
    if (url.pathname === "/rest/v1/profiles") {
      return new Response(JSON.stringify({ org_id: "synthetic-org" }), {
        headers: { "content-type": "application/vnd.pgrst.object+json" },
      });
    }
    if (url.pathname === "/rest/v1/rpc/rate_limit_hit") return Response.json(true);
    if (url.pathname === "/rest/v1/rpc/service_feature_enabled") {
      const key = (JSON.parse(await request.clone().text()) as { p_key: string }).p_key;
      return Response.json(key === "agent_assistant");
    }
    if (url.pathname === "/rest/v1/error_events") return new Response(null, { status: 201 });
    throw new Error(`unexpected fetch: ${request.method} ${url.pathname}`);
  }) as typeof fetch;
  try {
    const response = await handleAgentChatRequest(new Request("http://edge.test/agent-chat", {
      method: "POST",
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
      body,
    }));
    return { response, paths };
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value as string);
    }
  }
}

Deno.test("agent-chat caps the request body at 1 MiB", () => {
  assertEquals(MAX_REQUEST_BODY_BYTES, 1024 * 1024);
});

Deno.test("agent-chat answers 413 PAYLOAD_TOO_LARGE for a body over the cap, before any model request", async () => {
  const { response, paths } = await send(bodyOfSize(MAX_REQUEST_BODY_BYTES + 1));
  assertEquals(response.status, 413);
  assertEquals((await response.json()).error, "PAYLOAD_TOO_LARGE");
  assertEquals(paths.some((path) => path.includes("chat/completions")), false);
});

Deno.test("agent-chat answers 413 for an over-cap body streamed without a Content-Length", async () => {
  const { response } = await send(streamOf(bodyOfSize(MAX_REQUEST_BODY_BYTES + 1)));
  assertEquals(response.status, 413);
  assertEquals((await response.json()).error, "PAYLOAD_TOO_LARGE");
});

Deno.test("agent-chat reads a body of exactly the cap and parses it", async () => {
  // Exactly MAX bytes is allowed through the cap; this one is malformed JSON, so it reaches the parse step's 400.
  const { response } = await send("{" + " ".repeat(MAX_REQUEST_BODY_BYTES - 1));
  assertEquals(response.status, 400);
  assertEquals((await response.json()).error, "BAD_REQUEST");
});

Deno.test("agent-chat still answers 400 for malformed JSON under the cap", async () => {
  const { response } = await send("{");
  assertEquals(response.status, 400);
  assertEquals((await response.json()).error, "BAD_REQUEST");
});
