import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AGENT_READ_ROW_CAP,
  ORG_B_ID,
  mintJwt,
  readAllCompanyIds,
  setupFixtures,
  teardownFixtures,
  USER_A_EMAIL,
  USER_A_PASSWORD,
  type Fixtures,
} from "../fixtures";

const SIDECAR_URL = process.env.SIDECAR_URL ?? "http://127.0.0.1:8100";
const ACTION = `${SIDECAR_URL}/_agent-native/actions/query_entity`;

let fx: Fixtures;
let jwtA = "";

async function callQueryEntity(body: Record<string, unknown>) {
  const res = await fetch(ACTION, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwtA}`,
    },
    body: JSON.stringify(body),
  });

  return {
    status: res.status,
    json: await res.json() as {
      rowCount?: number;
      rows?: Array<Record<string, unknown>>;
      error?: { code?: string; message?: string };
    },
  };
}

beforeAll(async () => {
  fx = await setupFixtures();
  jwtA = await mintJwt(USER_A_EMAIL, USER_A_PASSWORD);
});

afterAll(async () => {
  await teardownFixtures(fx);
});

describe("AC-404 query_entity", () => {
  it("AC-404 returns caller-scoped rows only and enforces the read row cap", async () => {
    const { json } = await callQueryEntity({
      entity: "companies",
      columns: ["id", "name", "type", "created_at"],
      limit: AGENT_READ_ROW_CAP + 25,
    });

    expect(json.error, `query_entity failed: ${JSON.stringify(json)}`).toBeUndefined();
    expect(json.rowCount).toBe(AGENT_READ_ROW_CAP);
    expect(json.rows).toHaveLength(AGENT_READ_ROW_CAP);

    const { org1, org2 } = await readAllCompanyIds(fx.sql);
    const seenIds = new Set((json.rows ?? []).map((row) => String(row.id)));
    const leakedOrg2 = org2.filter((id) => seenIds.has(id));
    const outOfScope = [...seenIds].filter((id) => !org1.includes(id));

    expect(leakedOrg2, `org-${ORG_B_ID} company leaked through query_entity`).toEqual([]);
    expect(outOfScope, `query_entity returned ids outside caller org scope`).toEqual([]);
  });

  it("AC-404 rejects unknown entities before any business read", async () => {
    const { json } = await callQueryEntity({
      entity: "secret_table",
      columns: ["id"],
    });

    expect(json.rows).toBeUndefined();
    // I-1: every non-allow-listed entity is rejected with a uniform
    // "read not permitted" message before any business read (least-privilege:
    // the message does not reveal which entities exist).
    expect(json.error?.message ?? "").toMatch(/read not permitted for entity: secret_table/i);
  });

  it("AC-404 rejects unknown columns before any business read", async () => {
    const { json } = await callQueryEntity({
      entity: "companies",
      columns: ["id", "ssn"],
    });

    expect(json.rows).toBeUndefined();
    expect(json.error?.message ?? "").toMatch(/unknown column/i);
  });

  // ── I-1: runtime read allow-list (least-privilege) ────────────────────────
  // The agent's documented READ surface is projects + companies ONLY. Entities
  // that exist in PMO's wider viewspec whitelist but are NOT in the agent's read
  // allow-list — contacts (PII), tasks, user_views — MUST be refused before any
  // business read, even though they are otherwise valid viewspec entities.
  it.each([
    ["contacts", "PII"],
    ["tasks", "a write-only entity"],
    ["incidents", "not exposed to reads"],
    ["user_views", "internal config"],
  ])(
    "AC-404 rejects read of `%s` (%s) — outside the agent read allow-list",
    async (entity) => {
      const { json } = await callQueryEntity({
        entity,
        columns: ["id"],
      });

      expect(json.rows, `read of ${entity} must not return rows`).toBeUndefined();
      expect(json.rowCount).toBeUndefined();
      expect(json.error?.message ?? "", `read of ${entity} must be rejected`).toMatch(
        new RegExp(`read not permitted for entity: ${entity}`, "i"),
      );
    },
  );

  it("AC-404 allows read of projects (allow-listed) and scopes rows to the caller org", async () => {
    const { json } = await callQueryEntity({
      entity: "projects",
      columns: ["id", "name", "code"],
    });

    expect(json.error, `projects read failed: ${JSON.stringify(json)}`).toBeUndefined();
    expect(json.rowCount ?? 0).toBeGreaterThan(0);
    // Positive control: the org-1 fixture project is visible to user A.
    const seenCodes = (json.rows ?? []).map((row) => String(row.code));
    expect(seenCodes, "user A should see its own org's project").toContain("AN-E2-A");
    // Negative oracle: org-2's project (AN-E2-B) must be invisible (RLS).
    expect(seenCodes, "org-2 project must not leak").not.toContain("AN-E2-B");
  });
});
