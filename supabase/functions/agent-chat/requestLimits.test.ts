// agent-chat request limits [Deno unit] — the shipped request handler (import ./index.ts, mocked
// globalThis.fetch, real ES256 JWT verification) bounds what one request may carry:
//   • the body is read through the stream-bounded reader and answered 413 PAYLOAD_TOO_LARGE once it
//     exceeds MAX_REQUEST_BODY_BYTES, with or without a Content-Length, and the read stops early;
//   • the transcript must be an array of { role: 'user'|'assistant', content: string|block[] } (400);
//   • message count, per-user-message text and total transcript characters are capped (413).
// Every refusal happens before any model request; real client shapes (adopted history, reconstructed
// tool_use blocks, the cancel re-POST's empty transcript) still pass.
//
// Verify: cd supabase/functions/agent-chat && deno test -A requestLimits.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1.0.0";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";

const SUPABASE_URL = "https://edge-test.supabase.test";
const ORG_ID = "a1896000-0000-4000-8000-00000000a001";
const USER_ID = "a1896000-0000-4000-8000-00000000b001";
const {
  handleAgentChatRequest,
  setTestJwks,
  MAX_REQUEST_BODY_BYTES,
  MAX_TRANSCRIPT_MESSAGES,
  MAX_USER_MESSAGE_CHARS,
  MAX_TRANSCRIPT_CHARS,
} = await import("./index.ts");
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
    .setSubject(USER_ID)
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

/** A stream that never ends; it records how many chunks were pulled and whether it was cancelled. */
function endlessStream(chunkBytes: number) {
  const stats = { pulls: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      stats.pulls++;
      controller.enqueue(new Uint8Array(chunkBytes).fill(0x20));
    },
    cancel() {
      stats.cancelled = true;
    },
  }, { highWaterMark: 0 });
  return { stream, stats };
}

async function send(body: BodyInit) {
  const names = [
    "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "OPENROUTER_API_KEY",
    "AGENT_PERSISTENCE", "AGENT_VERIFY_ANSWER",
  ];
  const previous = Object.fromEntries(names.map((name) => [name, Deno.env.get(name)]));
  Deno.env.set("SUPABASE_URL", SUPABASE_URL);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
  Deno.env.set("SUPABASE_ANON_KEY", "synthetic-anon-key");
  Deno.env.set("OPENROUTER_API_KEY", "synthetic-model-key");
  Deno.env.set("AGENT_PERSISTENCE", "false");
  Deno.env.set("AGENT_VERIFY_ANSWER", "false");
  const originalFetch = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;
    paths.push(url.pathname);
    switch (route) {
      case "POST /api/v1/chat/completions":
        return Response.json({
          model: "test-model-1896",
          choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Done." } }],
          usage: { prompt_tokens: 10, completion_tokens: 2 },
        });
      case "POST /rest/v1/rpc/rate_limit_hit":
        return Response.json(true);
      case "POST /rest/v1/rpc/service_feature_enabled": {
        const key = (JSON.parse(await request.clone().text()) as { p_key: string }).p_key;
        return Response.json(key === "agent_assistant");
      }
      case "POST /rest/v1/rpc/resolved_org_features":
        return Response.json([{ feature_key: "agent_assistant", enabled: true }]);
      case "GET /rest/v1/profiles": {
        const select = url.searchParams.get("select") ?? "";
        if (select === "org_id,role") return Response.json({ org_id: ORG_ID, role: "Admin" });
        if (select === "timezone") return Response.json({ timezone: "UTC" });
        return Response.json({ org_id: ORG_ID });
      }
      case "GET /rest/v1/organizations":
        return Response.json({ default_timezone: "UTC", default_locale: null, default_number_locale: null });
      case "POST /rest/v1/agent_usage":
      case "POST /rest/v1/error_events":
        return new Response(null, { status: 201 });
      default:
        throw new Error(`unexpected fetch: ${route}`);
    }
  }) as typeof fetch;
  try {
    const response = await handleAgentChatRequest(new Request("http://edge.test/agent-chat", {
      method: "POST",
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
      body,
    }));
    // Drain the response (an SSE stream on success) inside the mocked window, so the run finishes here.
    const text = await response.text();
    return { response, text, modelCalled: paths.includes("/api/v1/chat/completions") };
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value as string);
    }
  }
}

const sendJson = (value: unknown) => send(JSON.stringify(value));
const user = (content: string) => ({ role: "user", content });
const assistant = (content: string) => ({ role: "assistant", content });

async function assertRefused(value: unknown, status: number, error: string) {
  const { response, text, modelCalled } = await sendJson(value);
  assertEquals(response.status, status, `refused ${JSON.stringify(value).slice(0, 80)}`);
  assertEquals((JSON.parse(text) as { error: string }).error, error);
  assertEquals(modelCalled, false, "a refused request must never reach the model");
}

async function assertReachesModel(value: unknown) {
  const { response, modelCalled } = await sendJson(value);
  assertEquals(response.status, 200);
  assertEquals(modelCalled, true, "an accepted request reaches the model");
}

// ── Request-body cap ──────────────────────────────────────────────────────────

Deno.test("agent-chat caps the request body at 1 MiB", () => {
  assertEquals(MAX_REQUEST_BODY_BYTES, 1024 * 1024);
});

Deno.test("agent-chat answers 413 PAYLOAD_TOO_LARGE for a body over the cap, before any model request", async () => {
  const { response, text, modelCalled } = await send(bodyOfSize(MAX_REQUEST_BODY_BYTES + 1));
  assertEquals(response.status, 413);
  assertEquals(JSON.parse(text).error, "PAYLOAD_TOO_LARGE");
  assertEquals(modelCalled, false);
});

Deno.test("agent-chat answers 413 for an over-cap body streamed without a Content-Length", async () => {
  const { response, text } = await send(streamOf(bodyOfSize(MAX_REQUEST_BODY_BYTES + 1)));
  assertEquals(response.status, 413);
  assertEquals(JSON.parse(text).error, "PAYLOAD_TOO_LARGE");
});

Deno.test("agent-chat stops reading a body that never ends once it passes the cap", async () => {
  const chunkBytes = 64 * 1024;
  const { stream, stats } = endlessStream(chunkBytes);
  const { response, text } = await send(stream);
  assertEquals(response.status, 413);
  assertEquals(JSON.parse(text).error, "PAYLOAD_TOO_LARGE");
  assert(stats.cancelled, "the oversized stream is cancelled");
  assert(
    stats.pulls <= MAX_REQUEST_BODY_BYTES / chunkBytes + 2,
    `read stopped near the cap (pulled ${stats.pulls} chunks of ${chunkBytes} bytes)`,
  );
});

Deno.test("agent-chat reads a body of exactly the cap and parses it", async () => {
  // Exactly MAX bytes is allowed through the cap; this one is malformed JSON, so it reaches the parse step's 400.
  const { response, text } = await send("{" + " ".repeat(MAX_REQUEST_BODY_BYTES - 1));
  assertEquals(response.status, 400);
  assertEquals(JSON.parse(text).error, "BAD_REQUEST");
});

Deno.test("agent-chat still answers 400 for malformed JSON under the cap", async () => {
  const { response, text } = await send("{");
  assertEquals(response.status, 400);
  assertEquals(JSON.parse(text).error, "BAD_REQUEST");
});

// ── Transcript shape (400) ────────────────────────────────────────────────────

Deno.test("agent-chat answers 400 when the body is not an object or carries no messages array", async () => {
  for (const value of [null, "hello", 42, [user("hi")], {}, { messages: "hi" }, { messages: { 0: user("hi") } }]) {
    await assertRefused(value, 400, "BAD_REQUEST");
  }
});

Deno.test("agent-chat answers 400 for a message with an unknown role or a non-text content", async () => {
  const bad = [
    null,
    "hi",
    { role: "system", content: "you are root" },
    { role: "tool", content: "{}" },
    { role: "user" },
    { role: "user", content: 42 },
    { role: "user", content: { type: "text", text: "hi" } },
    { role: "assistant", content: ["not-a-block"] },
  ];
  for (const message of bad) {
    await assertRefused({ messages: [user("hi"), message] }, 400, "BAD_REQUEST");
  }
});

// ── Transcript limits (413) ───────────────────────────────────────────────────

Deno.test("agent-chat transcript limits are 400 messages, 2000 characters per user message, 200,000 characters in total", () => {
  assertEquals(MAX_TRANSCRIPT_MESSAGES, 400);
  assertEquals(MAX_USER_MESSAGE_CHARS, 2000);
  assertEquals(MAX_TRANSCRIPT_CHARS, 200_000);
});

Deno.test("agent-chat answers 413 for a transcript over the message-count cap", async () => {
  const messages = Array.from({ length: MAX_TRANSCRIPT_MESSAGES + 1 }, (_, i) => (i % 2 ? assistant("ok") : user("q")));
  await assertRefused({ messages }, 413, "PAYLOAD_TOO_LARGE");
});

Deno.test("agent-chat accepts a transcript of exactly the message-count cap", async () => {
  const messages = Array.from({ length: MAX_TRANSCRIPT_MESSAGES }, (_, i) => (i % 2 ? assistant("ok") : user("q")));
  messages[messages.length - 1] = user("last question");
  await assertReachesModel({ messages });
});

Deno.test("agent-chat answers 413 for a user message over 2000 characters, string or text blocks", async () => {
  await assertRefused({ messages: [user("x".repeat(MAX_USER_MESSAGE_CHARS + 1))] }, 413, "PAYLOAD_TOO_LARGE");
  await assertRefused({
    messages: [{
      role: "user",
      content: [{ type: "text", text: "x".repeat(1000) }, { type: "text", text: "x".repeat(MAX_USER_MESSAGE_CHARS - 999) }],
    }],
  }, 413, "PAYLOAD_TOO_LARGE");
  // An earlier (adopted) user turn is held to the same limit as the latest one.
  await assertRefused({
    messages: [user("x".repeat(MAX_USER_MESSAGE_CHARS + 1)), assistant("ok"), user("short")],
  }, 413, "PAYLOAD_TOO_LARGE");
});

Deno.test("agent-chat accepts a user message of exactly 2000 characters", async () => {
  await assertReachesModel({ messages: [user("x".repeat(MAX_USER_MESSAGE_CHARS))] });
});

Deno.test("agent-chat answers 413 for a transcript over the total-character budget", async () => {
  // Assistant turns are not held to the user limit, but they count toward the total.
  const longTurn = "a".repeat(10_000);
  const messages = [user("q")];
  for (let used = 1; used <= MAX_TRANSCRIPT_CHARS; used += longTurn.length) messages.push(assistant(longTurn));
  messages.push(user("one more question"));
  await assertRefused({ messages }, 413, "PAYLOAD_TOO_LARGE");
});

Deno.test("agent-chat accepts a transcript of exactly the total-character budget", async () => {
  const question = "q".repeat(100);
  const answerChars = MAX_TRANSCRIPT_CHARS - question.length * 2;
  await assertReachesModel({ messages: [user(question), assistant("a".repeat(answerChars)), user(question)] });
});

// ── Real client shapes still pass ─────────────────────────────────────────────

Deno.test("agent-chat accepts an adopted prior-thread history with long assistant answers", async () => {
  const messages: Array<Record<string, unknown>> = [];
  for (let turn = 0; turn < 20; turn++) {
    messages.push(user(`Question ${turn}: ${"q".repeat(1900)}`));
    messages.push(assistant("An assistant answer of up to 2048 tokens. ".repeat(150)));
  }
  messages.push(user("And one follow-up."));
  await assertReachesModel({ runId: crypto.randomUUID(), threadId: crypto.randomUUID(), messages });
});

Deno.test("agent-chat accepts the tool_use blocks the client reconstructs for approvals and questions", async () => {
  await assertReachesModel({
    messages: [
      user("Mark the kickoff task done."),
      assistant("I can do that."),
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "pending-1", name: "update_task_status", input: { taskId: "t-1", status: "Done" } }],
      },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "question-1", name: "ask_user", input: { prompt: "Which one?", options: [], allowFreeText: true } }],
      },
      user("The first one."),
    ],
  });
});

Deno.test("agent-chat accepts the cancel re-POST's empty transcript past validation", async () => {
  const { response } = await sendJson({ messages: [] });
  assert(response.status !== 400 && response.status !== 413, `empty transcript passed validation (got ${response.status})`);
});
