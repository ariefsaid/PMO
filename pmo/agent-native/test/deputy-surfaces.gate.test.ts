/**
 * DEPUTY-SURFACES GATE (E6) — the expanded deputy-invariant canary (G2 + G3).
 *
 * The original `deputy-invariant.gate.test.ts` (AC-403) proves the deputy
 * invariant on the classic `defineAction` data path (the 5/5). E6 expands the
 * canary to EVERY caller-executing surface the embedded sidecar exposes —
 * `defineAction`, MCP (`/_agent-native/mcp`), A2A (`/_agent-native/a2a`),
 * the public agent-card, `defineClientAction`, embed fetches — so an upstream
 * `@agent-native/core` bump that opens a hole on any of them goes RED in CI.
 *
 * The load-bearing fact (see SECURITY.md): PMO business data is reachable ONLY
 * through the four PMO `defineAction`s, and each resolves caller identity
 * SOLELY from the host deputy `AsyncLocalStorage` (`getCallerJwt()`), populated
 * ONLY by the GLOBAL deputy middleware for a verified PMO Supabase jwt. RLS is
 * the ceiling. Every surface below either (a) cannot reach a PMO action, or
 * (b) funnels through that same seam.
 *
 * Assertions (each tagged AC-6xx — grep-traceable):
 *   AC-601  surface enumeration — every caller-executing surface recorded with
 *           its exposure + auth model.
 *   AC-602  MCP — PMO actions are NOT MCP tools; tools/call refused; no PMO data.
 *   AC-603  A2A — message/send rejects anon + non-A2A tokens; no PMO public skill;
 *           no org-2 data leaks on an authenticated cross-tenant attempt.
 *   AC-604  agent-card.json — public metadata only; no PMO tenant identifier.
 *   AC-605  defineClientAction — PMO registers none that touch PMO data.
 *   AC-606  deputy ALS is the SOLE caller-identity source across all surfaces
 *           (static scan over all 4 actions + the seam) + no-bearer→refused runtime.
 *   AC-607  ADR-0039 boundary — PMO actions emit NO render/execute output (no
 *           sidecar validator needed yet; composition validator is pmo-portal AC-417).
 *
 * Sidecar is booted once by vitest globalSetup (test/global-setup.ts) at
 * SIDECAR_URL. Fixtures mirror the AC-403 gate: two orgs, a user per org, so a
 * "cross-tenant" assertion has a real org-2 row to fail to find.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import postgres from "postgres";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CO_B_ID,
  ORG_B_ID,
  USER_A_EMAIL,
  USER_A_PASSWORD,
  mintJwt,
  setupFixtures,
  teardownFixtures,
  type Fixtures,
} from "./fixtures";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SIDECAR_URL = process.env.SIDECAR_URL ?? "http://127.0.0.1:8100";
const ACTION_DIR = resolve(projectRoot, "server/actions");

let fx: Fixtures;
let jwtA = ""; // org-1 Admin

beforeAll(async () => {
  fx = await setupFixtures();
  jwtA = await mintJwt(USER_A_EMAIL, USER_A_PASSWORD);
});

afterAll(async () => {
  await teardownFixtures(fx);
});

// ── HTTP probe helpers ──────────────────────────────────────────────────────

interface ProbeResult {
  status: number;
  text: string;
  headers: Headers;
}

async function probe(
  method: string,
  path: string,
  opts: { jwt?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<ProbeResult> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (opts.jwt) headers["Authorization"] = `Bearer ${opts.jwt}`;
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const res = await fetch(`${SIDECAR_URL}${path}`, init);
  return { status: res.status, text: await res.text(), headers: res.headers };
}

/** MCP streamable-HTTP JSON-RPC call. Forwards any Mcp-Session-Id it observes. */
let mcpSessionId: string | null = null;
async function mcpCall(
  method: string,
  params: unknown,
  jwt?: string,
): Promise<{ status: number; json: any; text: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // The MCP streamable transport REQUIRES both accept types or it 406s.
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-06-18",
  };
  if (jwt) headers["Authorization"] = `Bearer ${jwt}`;
  if (mcpSessionId) headers["Mcp-Session-Id"] = mcpSessionId;
  const res = await fetch(`${SIDECAR_URL}/_agent-native/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: Math.floor(Math.random() * 1e9), method, params }),
  });
  // Capture the session the server offered (if any) for subsequent calls.
  const sid = res.headers.get("mcp-session-id") ?? res.headers.get("Mcp-Session-Id");
  if (sid) mcpSessionId = sid;
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Non-JSON (e.g. SSE frame, HTML fallback) — leave json null; text is the evidence.
  }
  return { status: res.status, json, text };
}

/** True if any PMO tenant identifier appears in a response body (the leak check). */
function leaksTenantData(text: string): boolean {
  // ORG_B_ID (org-2), CO_B_ID (the org-2 company), and its seeded name.
  return (
    text.includes(ORG_B_ID) ||
    text.includes(CO_B_ID) ||
    text.includes("Step5 Gate Co B") ||
    text.includes("Step5 Gate Contact B")
  );
}

// ── AC-601: surface enumeration ─────────────────────────────────────────────

describe("AC-601 SURFACE ENUMERATION — every caller-executing surface recorded", () => {
  it("defineAction data path is exposed and auth-gated", async () => {
    // Mounted (not 404) and refuses an anonymous caller.
    const anon = await probe("POST", "/_agent-native/actions/pmo_query", {
      body: { op: "list_companies" },
    });
    expect(anon.status, "action endpoint must be mounted (not 404)").not.toBe(404);
    expect(anon.status, "anonymous action call must be refused").toBe(401);
  });

  it("MCP tool server is exposed (responds to the protocol handshake)", async () => {
    const init = await mcpCall("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "e6-gate", version: "1" },
    });
    expect(init.status, "MCP initialize must respond (surface exposed)").not.toBe(404);
    // 200 on a clean handshake; the surface is reachable — that is the point.
    expect(init.json?.result?.serverInfo, "MCP must return serverInfo on initialize").toBeTruthy();
  });

  it("A2A JSON-RPC endpoint is exposed (responds to JSON-RPC)", async () => {
    // A well-formed message/send from an anonymous caller returns a JSON-RPC
    // error (not 404 / not HTML) — proving the A2A handler is mounted.
    const res = await probe("POST", "/_agent-native/a2a", {
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: { message: { role: "user", parts: [{ type: "text", text: "hi" }] } },
      },
    });
    expect(res.status, "A2A endpoint must be mounted (not 404)").not.toBe(404);
    expect(res.text, "A2A must return a JSON-RPC envelope").toContain("jsonrpc");
  });

  it("agent-card.json public-metadata route is reachable without auth", async () => {
    const res = await probe("GET", "/.well-known/agent-card.json");
    expect(res.status, "agent-card route must respond (public metadata)").not.toBe(404);
  });

  it("resources CRUD is exposed and auth-gated (framework tables, not PMO)", async () => {
    const anon = await probe("GET", "/_agent-native/resources");
    expect(anon.status, "resources endpoint must be mounted (not 404)").not.toBe(404);
    expect(anon.status, "anonymous resources call must be refused").toBe(401);
  });
});

// ── AC-602: MCP deputy-invariant ────────────────────────────────────────────

describe("AC-602 MCP — PMO actions are not MCP tools; no PMO data reachable", () => {
  const PMO_ACTIONS = ["pmo_query", "query_entity", "create_activity", "update_task_status"];

  it("PMO actions are absent from the UNAUTHENTICATED MCP tool catalog", async () => {
    const res = await mcpCall("tools/list", {});
    const tools: any[] = res.json?.result?.tools ?? [];
    const names = tools.map((t) => t.name);
    for (const action of PMO_ACTIONS) {
      expect(names, `PMO action ${action} must NOT be an unauthenticated MCP tool`).not.toContain(action);
    }
  });

  it("PMO actions are absent from the AUTHENTICATED (PMO-jwt) MCP tool catalog", async () => {
    const res = await mcpCall("tools/list", {}, jwtA);
    const tools: any[] = res.json?.result?.tools ?? [];
    const names = tools.map((t) => t.name);
    for (const action of PMO_ACTIONS) {
      expect(names, `PMO action ${action} must NOT be an authenticated MCP tool`).not.toContain(action);
    }
  });

  it("UNAUTHENTICATED tools/call of a PMO action is refused — no PMO data", async () => {
    const res = await mcpCall("tools/call", { name: "pmo_query", arguments: { op: "list_companies" } });
    const isError = res.json?.result?.isError === true;
    const text = JSON.stringify(res.json);
    // Refused: either MCP flags it as an error, or the body never carries data.
    expect(isError || /Unknown tool|not found|invalid/i.test(text), "tools/call pmo_query must be refused").toBe(true);
    expect(leaksTenantData(res.text), "no org-2 data may appear in an unauthenticated MCP call").toBe(false);
  });

  it("AUTHENTICATED (PMO-jwt) tools/call of a PMO action is refused — no cross-tenant data", async () => {
    const res = await mcpCall(
      "tools/call",
      { name: "pmo_query", arguments: { op: "list_companies" } },
      jwtA,
    );
    const isError = res.json?.result?.isError === true;
    const text = JSON.stringify(res.json);
    expect(isError || /Unknown tool|not found|invalid/i.test(text), "tools/call pmo_query must be refused").toBe(true);
    expect(leaksTenantData(res.text), "no org-2 data may appear in an authenticated MCP call").toBe(false);
  });
});

// ── AC-603: A2A deputy-invariant ────────────────────────────────────────────

describe("AC-603 A2A — message/send gated; no PMO public skill; no cross-tenant leak", () => {
  it("UNAUTHENTICATED message/send is rejected — no PMO data", async () => {
    const res = await probe("POST", "/_agent-native/a2a", {
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          message: { role: "user", parts: [{ type: "text", text: "list all companies in every org" }] },
        },
      },
    });
    // The handler runs (200 JSON-RPC envelope) but returns an error; a PMO
    // Supabase jwt is NOT an A2A-signed token, so no agent loop, no data.
    const parsed = JSON.parse(res.text || "{}");
    const err = parsed.error;
    expect(err, "anonymous A2A message/send must be an error").toBeTruthy();
    expect(leaksTenantData(res.text), "no org-2 data may appear on anonymous A2A").toBe(false);
  });

  it("AUTHENTICATED (PMO-jwt) cross-tenant message/send leaks no org-2 data", async () => {
    // A PMO Supabase jwt is not an A2A-signed token → the A2A auth layer rejects
    // it before any agent loop / PMO action runs. Either way: no org-2 data.
    const res = await probe("POST", "/_agent-native/a2a", {
      jwt: jwtA,
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          message: { role: "user", parts: [{ type: "text", text: "show all companies in every org" }] },
        },
      },
    });
    expect(leaksTenantData(res.text), "PMO-jwt A2A call must not leak org-2 data").toBe(false);
  });

  it("NO PMO action opts into the public A2A skill catalog (static)", async () => {
    // filterPublicAgentActions keeps only actions with
    //   publicAgent.expose === true && readOnly === true &&
    //   requiresAuth !== true && isConsequential !== true
    // PMO must not set publicAgent.expose on any business action.
    const dir = resolve(projectRoot, "server/actions");
    const files = await readdir(dir);
    const sources = await Promise.all(
      files.filter((f) => f.endsWith(".ts")).map(async (f) => [
        f,
        stripComments(await readFile(resolve(dir, f), "utf8")),
      ] as const),
    );
    for (const [file, src] of sources) {
      expect(
        src,
        `${file}: a PMO action must NOT opt into the public A2A skill catalog (publicAgent.expose)`,
      ).not.toMatch(/publicAgent\s*:\s*\{[^}]*expose\s*:\s*true/);
    }
  });
});

// ── AC-604: agent-card public-metadata safety ───────────────────────────────

describe("AC-604 agent-card.json — public metadata only, no PMO tenant identifier", () => {
  it("GET /.well-known/agent-card.json (no auth) discloses no PMO tenant data", async () => {
    const res = await probe("GET", "/.well-known/agent-card.json");
    // Public by design; may be JSON metadata or the dev-server SPA fallback.
    // Either way it MUST NOT carry a PMO tenant identifier.
    expect(leaksTenantData(res.text), "agent-card must not disclose org-2 tenant data").toBe(false);
  });
});

// ── AC-605: defineClientAction ──────────────────────────────────────────────

describe("AC-605 defineClientAction — no PMO client action touches PMO data", () => {
  it("PMO registers no client action that reaches PMO data (static)", async () => {
    // client actions run in the browser and have no server-confirmed identity.
    // If any PMO client action needs PMO data it MUST round-trip through a
    // server defineAction (deputy seam). Scan all PMO source for defineClientAction.
    const roots = ["server", "app", "embed"].map((r) => resolve(projectRoot, r));
    const hits: string[] = [];
    for (const root of roots) {
      let entries: string[] = [];
      try {
        entries = await readdir(root, { recursive: true, withFileTypes: true }).then((ds) =>
          ds.filter((d) => d.isFile() && d.name.endsWith(".ts") && !d.name.endsWith(".d.ts")).map((d) =>
            resolve(d.parentPath, d.name),
          ),
        );
      } catch {
        continue; // root may not exist (e.g. app/)
      }
      for (const file of entries) {
        const src = stripComments(await readFile(file, "utf8"));
        if (!/\bdefineClientAction\b/.test(src)) continue;
        // A client action that ALSO references a PMO data seam is the violation.
        if (/createCallerClient|getCallerJwt|@supabase\/supabase-js|repositories\//.test(src)) {
          hits.push(file);
        }
      }
    }
    expect(
      hits,
      "no PMO client action may touch PMO data directly — round-trip via a server defineAction",
    ).toEqual([]);
  });
});

// ── AC-606: deputy ALS is the SOLE caller-identity source (upgrade canary) ───

describe("AC-606 deputy seam — sole caller-identity source across ALL surfaces", () => {
  it("EVERY PMO action resolves caller identity via getCallerJwt + createCallerClient (static)", async () => {
    // The canary: if a future action (or upstream seam) builds its data client
    // any other way, this goes RED. Mirrors AC-403 gate-4 but over ALL actions.
    const files = (await readdir(ACTION_DIR)).filter((f) => f.endsWith(".ts"));
    expect(files.length, "expected the 4 PMO actions").toBeGreaterThanOrEqual(4);
    for (const f of files) {
      const src = stripComments(await readFile(resolve(ACTION_DIR, f), "utf8"));
      expect(src, `${f}: must call getCallerJwt()`).toMatch(/getCallerJwt\(/);
      expect(src, `${f}: must build its data client via createCallerClient(jwt)`).toMatch(
        /createCallerClient\(/,
      );
      // The business path must never construct/import a service_role client.
      expect(src, `${f}: must NOT reference service_role`).not.toMatch(
        /createVerifierClient|SUPABASE_SERVICE_ROLE_KEY/,
      );
      // Must refuse when there is no caller JWT (no silent anon-without-identity).
      expect(src, `${f}: must refuse when getCallerJwt() is undefined`).toMatch(
        /if\s*\(\s*!jwt\s*\)/,
      );
    }
  });

  it("the deputy store + middleware are the ONLY ALS populator (static)", async () => {
    const storeSrc = stripComments(await readFile(resolve(projectRoot, "server/lib/deputy-store.ts"), "utf8"));
    const mwSrc = stripComments(await readFile(resolve(projectRoot, "server/middleware/deputy.ts"), "utf8"));
    // The store exports runWithDeputy (the only enter) + getCallerJwt/getDeputyContext (reads).
    expect(storeSrc).toMatch(/export function runWithDeputy/);
    expect(storeSrc).toMatch(/export function getCallerJwt/);
    // The middleware is the single populator: it verifies the jwt then enters the scope.
    expect(mwSrc).toMatch(/verifyJwt/);
    expect(mwSrc).toMatch(/runWithDeputy/);
    // service_role is confined to the verifier (getUser + profiles identity) — see AC-403 gate-4.
    const supaSrc = stripComments(await readFile(resolve(projectRoot, "server/lib/supabase.ts"), "utf8"));
    const verifyBlock = supaSrc.split("function verifyJwt")[1] ?? "";
    expect(verifyBlock, "verifyJwt must NOT touch business tables").not.toMatch(
      /\.from\(\s*['"](companies|contacts|crm_activities|projects|deals|tasks|opportunities)['"]\)/,
    );
  });

  it("RUNTIME: a PMO action with NO caller jwt is refused (no business path without identity)", async () => {
    // The framework's session gate turns anon into 401 before the action — but
    // even if that ever changed, the action's getCallerJwt() guard is the
    // backstop. Assert both: anon is rejected AND no data leaks.
    const res = await probe("POST", "/_agent-native/actions/pmo_query", {
      body: { op: "list_companies" },
    });
    expect(res.status, "anonymous action call must be refused").toBe(401);
    expect(leaksTenantData(res.text), "no org-2 data on anonymous action call").toBe(false);
  });

  it("RUNTIME: an authenticated caller sees ONLY its own org (cross-tenant read denied)", async () => {
    // Positive control that the deputy seam resolves as the caller on the data
    // path: user A (org 1) lists companies and gets NONE from org 2.
    const res = await probe("POST", "/_agent-native/actions/pmo_query", {
      jwt: jwtA,
      body: { op: "list_companies" },
    });
    expect(res.status, "authenticated list_companies must succeed").toBe(200);
    const body = JSON.parse(res.text);
    expect(body.error, `unexpected error: ${JSON.stringify(body.error)}`).toBeUndefined();
    // Positive control: user A DOES see its own org's companies (non-empty) …
    expect(Array.isArray(body.rows) && body.rows.length > 0, "user A must see its own org's companies").toBe(true);
    // … and the negative oracle: NONE of them are org-2's.
    expect(leaksTenantData(res.text), "user A must not see any org-2 company").toBe(false);
    // Ground truth: org-2 has exactly one company (CO_B_ID) right now.
    const sql = postgres({
      host: "127.0.0.1",
      port: 54322,
      user: "postgres",
      database: "postgres",
      password: "postgres",
      idle_timeout: 5,
    });
    try {
      const org2 = await sql`select id from companies where org_id = ${ORG_B_ID}`;
      expect(org2.length, "fixture: org-2 should have its gate company present").toBe(1);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});

// ── AC-607: ADR-0039 untrusted-output boundary ──────────────────────────────

describe("AC-607 ADR-0039 boundary — PMO actions emit no render/execute output", () => {
  it("PMO actions return plain structured data only — no render/execute payload (static)", async () => {
    // PMO controls NO model-authored render/execute output through the sidecar
    // today (agent-native's OWN renderer is the framework's trust surface). The
    // canary fires if a PMO action starts IMPORTING the renderer/widget/block
    // SDK, emitting a `core.*` renderer id, or constructing/returning a
    // CompositionSpec — any of which is ADR-0039 untrusted-output subject matter
    // and would require a PMO-owned validator (+ a new AC-6xx row) before render.
    // NOTE: importing `viewspec/types` (the ENTITY_WHITELIST) is ALLOWED — that is
    // a PMO-internal type, not a render emission.
    const files = (await readdir(ACTION_DIR)).filter((f) => f.endsWith(".ts"));
    const FORBIDDEN =
      /from\s+['"]@agent-native\/core\/(action-ui|data-widgets|blocks)|['"]core\.(data-table|data-chart|data-insights|data-widget|inline-extension)['"]|\bCompositionSpec\b|compileCompositionSpec\s*\(|renderer\s*:\s*['"]/;
    for (const f of files) {
      const src = stripComments(await readFile(resolve(ACTION_DIR, f), "utf8"));
      expect(
        src,
        `${f}: a PMO action must NOT emit a render/execute payload without an ADR-0039 validator`,
      ).not.toMatch(FORBIDDEN);
    }
  });
});

/** Strip comments so the static guards scan code, not documentation. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/.*$/gm, "");
}
