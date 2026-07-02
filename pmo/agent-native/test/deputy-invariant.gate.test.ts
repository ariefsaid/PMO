/**
 * DEPUTY-INVARIANT GATE — the hard gate of the agent-native pilot (Step 5).
 *
 * Proves that the agent-native deputy path carries the real caller identity and
 * is DENIED both a cross-tenant READ and a cross-tenant WRITE, with no
 * service_role business path and full schema isolation. Drives the pmo_query
 * action over real HTTP (the full deputy chain: deputy middleware → ALS →
 * agent-native handler → action run → Supabase RLS), as genuine signed-in users
 * in two different orgs.
 *
 * 5 assertions (the gate conditions):
 *   1. Cross-tenant READ denied — user A sees ONLY org-1 companies; org-2's
 *      company is absent.
 *   2. Cross-tenant WRITE denied — user A writing an org-2 contact returns
 *      Postgres 42501 (parent-org WITH CHECK guard); insert MUST NOT succeed.
 *   3. Intra-tenant WRITE succeeds — user A writing an org-1 contact returns the
 *      inserted row (org_id stamped by trigger). Positive control for #2.
 *   4. No service_role business path — static scan: service_role appears only in
 *      the verifier (getUser + profiles identity), never in a `.from(...)` business
 *      call.
 *   5. Cross-schema isolation — agent-native's own tables live in `agent_native`,
 *      never `public`.
 *
 * If #1 or #2 is RED (any cross-tenant op succeeds), STOP — adoption is unsafe.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTACT_A_ID,
  CONTACT_B_ID,
  USER_A_EMAIL,
  USER_A_PASSWORD,
  USER_B_EMAIL,
  USER_B_PASSWORD,
  mintJwt,
  readAllCompanyIds,
  setupFixtures,
  teardownFixtures,
  type Fixtures,
} from "./fixtures";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SIDECAR_URL = "http://127.0.0.1:8100";

let fx: Fixtures;
let jwtA = ""; // org-1 Admin
let jwtB = ""; // org-2 Project Manager

const ACTION = `${SIDECAR_URL}/_agent-native/actions/pmo_query`;

/** POST the action as the given caller. */
async function callAction(
  jwt: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: any }> {
  const res = await fetch(ACTION, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

beforeAll(async () => {
  fx = await setupFixtures();
  jwtA = await mintJwt(USER_A_EMAIL, USER_A_PASSWORD);
  jwtB = await mintJwt(USER_B_EMAIL, USER_B_PASSWORD);
});

afterAll(async () => {
  await teardownFixtures(fx);
});

describe("AC-403 DEPUTY-INVARIANT GATE", () => {
  it("1. CROSS-TENANT READ denied — user A (org 1) cannot see org-2 companies", async () => {
    const { json } = await callAction(jwtA, { op: "list_companies" });

    // The action returns { rows: [...] } on success (never an error here — RLS
    // grants the caller its own org's rows).
    expect(json.error, `action returned an error: ${JSON.stringify(json.error)}`).toBeUndefined();
    const rows: Array<{ id: string; name: string }> = json.rows ?? [];
    const seenIds = new Set(rows.map((r) => r.id));

    // Ground truth: every org-2 company id that exists in the DB right now.
    const { org1, org2 } = await readAllCompanyIds(fx.sql);
    const leaked = org2.filter((id) => seenIds.has(id));

    // Evidence line for the report.
    process.stderr.write(
      `\n[gate-1] user A saw ${rows.length} companies; org-1 count in DB=${org1.length}, org-2 count in DB=${org2.length}; leaked org-2 rows=${leaked.length}\n`,
    );

    expect(leaked, `CROSS-TENANT READ LEAK: org-2 companies visible to user A: ${leaked.join(",")}`).toEqual([]);
  });

  it("2. CROSS-TENANT WRITE denied — user A writing org-2 contact → 42501", async () => {
    const res = await callAction(jwtA, {
      op: "create_activity",
      contact_id: CONTACT_B_ID, // org-2 contact
      kind: "Email",
      subject: "Step5 gate — must NOT persist (cross-tenant)",
    });

    const err = res.json?.error;
    process.stderr.write(
      `\n[gate-2] cross-tenant create_activity response: ${JSON.stringify(res.json)}\n`,
    );

    expect(err, "expected an error for cross-tenant write").toBeDefined();
    expect(err.code, `expected 42501, got: ${JSON.stringify(err)}`).toBe("42501");

    // Hard evidence: confirm NO row was persisted for this subject in either org.
    const persisted = await fx.sql`
      select id, org_id from crm_activities
      where subject = 'Step5 gate — must NOT persist (cross-tenant)'`;
    expect(persisted, "cross-tenant write must NOT persist any row").toHaveLength(0);
  });

  it("3. INTRA-TENANT WRITE succeeds — user A writing org-1 contact returns the row (positive control)", async () => {
    const res = await callAction(jwtA, {
      op: "create_activity",
      contact_id: CONTACT_A_ID, // org-1 contact, same org as user A
      kind: "Call",
      subject: "Step5 gate — intra-tenant positive control",
    });

    const row = res.json?.row;
    const err = res.json?.error;
    process.stderr.write(
      `\n[gate-3] intra-tenant create_activity response: ${JSON.stringify(res.json)}\n`,
    );

    expect(err, `positive control FAILED unexpectedly: ${JSON.stringify(err)}`).toBeUndefined();
    expect(row, "expected an inserted row").toBeDefined();
    expect(row.org_id, "trigger must stamp org_id to user A's org").toBe(
      "00000000-0000-0000-0000-000000000001",
    );
  });

  it("4. NO service_role business path — service_role only in verifier (getUser + profiles)", async () => {
    // Static guard over the deputy path source. The invariant:
    //   - The ONLY service_role constructor is `createVerifierClient` (in
    //     server/lib/supabase.ts), and it is called ONLY inside `verifyJwt`,
    //     which touches nothing but `auth.getUser` + the `profiles` identity read.
    //   - The business path (pmo_query action + deputy store + middleware) builds
    //     its data client via `createCallerClient` (anon key + caller JWT) and
    //     NEVER constructs/imports a service_role client.
    // Comments are stripped before scanning so documentation of the invariant
    // (which legitimately says "NEVER service_role") doesn't read as a violation.
    const actionPath = resolve(projectRoot, "server/actions/pmo-query.ts");
    const supaPath = resolve(projectRoot, "server/lib/supabase.ts");
    const deputyPath = resolve(projectRoot, "server/lib/deputy-store.ts");
    const mwPath = resolve(projectRoot, "server/middleware/deputy.ts");
    const actionSrc = stripComments(await readFile(actionPath, "utf8"));
    const supaSrc = stripComments(await readFile(supaPath, "utf8"));
    const deputySrc = stripComments(await readFile(deputyPath, "utf8"));
    const mwSrc = stripComments(await readFile(mwPath, "utf8"));
    const businessBlob = [actionSrc, deputySrc, mwSrc].join("\n");

    // (a) The action's data client is the deputy caller client (anon + caller JWT).
    expect(
      actionSrc,
      "pmo_query must build its data client via createCallerClient (anon key + caller JWT)",
    ).toMatch(/createCallerClient\(/);

    // (b) The business path must NOT construct or import a service_role client.
    //     (`createVerifierClient` / `SUPABASE_SERVICE_ROLE_KEY` are forbidden here.)
    expect(
      businessBlob,
      "business path must NOT reference createVerifierClient or SUPABASE_SERVICE_ROLE_KEY",
    ).not.toMatch(/createVerifierClient|SUPABASE_SERVICE_ROLE_KEY/);

    // (c) The verifier is the only place service_role is constructed, and it is
    //     called only inside verifyJwt.
    expect(supaSrc).toMatch(/function createVerifierClient/);
    const verifyBlock = supaSrc.split("function verifyJwt")[1] ?? "";
    // verifyJwt must NOT touch business tables — only `profiles` identity reads.
    expect(verifyBlock, "verifyJwt must NOT touch business tables").not.toMatch(
      /\.from\(\s*['"](companies|contacts|crm_activities|projects|deals|tasks|opportunities)['"]\)/,
    );

    process.stderr.write(
      `\n[gate-4] static scan OK — business path uses createCallerClient; service_role confined to createVerifierClient/verifyJwt identity reads\n`,
    );
  });

  it("5. CROSS-SCHEMA isolation — agent-native tables in `agent_native`, none leaked to `public`", async () => {
    // Use a fresh superuser connection (fx.sql works too).
    const sql = postgres({
      host: "127.0.0.1",
      port: 54322,
      user: "postgres",
      database: "postgres",
      password: "postgres",
      idle_timeout: 5,
    });
    try {
      const agentTables = (
        await sql`
          select table_name from information_schema.tables
          where table_schema = 'agent_native' order by table_name`
      ).map((r) => String(r.table_name));
      expect(agentTables.length, "agent_native schema should hold its framework tables").toBeGreaterThan(0);

      // The gate: none of agent-native's table names exist in `public`.
      const leaked = await sql`
        select table_name from information_schema.tables
        where table_schema = 'public' and table_name = any(${agentTables as unknown as string[]})`;
      const leakedNames = leaked.map((r) => String(r.table_name));

      process.stderr.write(
        `\n[gate-5] agent_native has ${agentTables.length} tables; leaked into public: ${leakedNames.length ? leakedNames.join(",") : "none"}\n`,
      );
      expect(
        leakedNames,
        `SCHEMA LEAK: agent-native tables found in public: ${leakedNames.join(",")}`,
      ).toEqual([]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});

/**
 * Strip `//` line comments and `/* ... *​/` block comments so the static guard
 * scans actual code, not documentation (the source legitimately mentions
 * "service_role" in comments explaining the invariant).
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/.*$/gm, "");
}
