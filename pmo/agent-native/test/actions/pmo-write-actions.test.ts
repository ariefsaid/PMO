import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CONTACT_A_ID,
  CONTACT_B_ID,
  ORG_A_ID,
  TASK_A_ID,
  TASK_B_ID,
  USER_A_EMAIL,
  USER_A_PASSWORD,
  mintJwt,
  readActivityBySubject,
  readTaskStatus,
  setupFixtures,
  teardownFixtures,
  type Fixtures,
} from "../fixtures";

const SIDECAR_URL = process.env.SIDECAR_URL ?? "http://127.0.0.1:8100";
const CREATE_ACTIVITY_ACTION = `${SIDECAR_URL}/_agent-native/actions/create_activity`;
const UPDATE_TASK_STATUS_ACTION = `${SIDECAR_URL}/_agent-native/actions/update_task_status`;

let fx: Fixtures;
let jwtA = "";

async function callAction(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
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
      id?: string;
      taskId?: string;
      status?: string;
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

describe("AC-405 PMO write actions", () => {
  it("AC-405 create_activity succeeds for a same-tenant contact and stamps org_id", async () => {
    const subject = `AC-405 same-tenant activity ${Date.now()}`;

    const { json } = await callAction(CREATE_ACTIVITY_ACTION, {
      contactId: CONTACT_A_ID,
      kind: "call",
      subject,
    });

    expect(json.error, `create_activity failed: ${JSON.stringify(json)}`).toBeUndefined();
    expect(json.id).toBeTruthy();

    const row = await readActivityBySubject(fx.sql, subject);
    expect(row?.id).toBe(json.id);
    expect(row?.org_id).toBe(ORG_A_ID);
    expect(row?.contact_id).toBe(CONTACT_A_ID);
  });

  it("AC-405 create_activity denies a cross-tenant contact with 42501 and persists nothing", async () => {
    const subject = `AC-405 cross-tenant activity ${Date.now()}`;

    const { json } = await callAction(CREATE_ACTIVITY_ACTION, {
      contactId: CONTACT_B_ID,
      kind: "email",
      subject,
    });

    expect(json.error, `expected 42501 denial, got ${JSON.stringify(json)}`).toBeDefined();
    expect(json.error?.code).toBe("42501");

    const row = await readActivityBySubject(fx.sql, subject);
    expect(row).toBeNull();
  });

  it("AC-405 update_task_status succeeds for a same-tenant task", async () => {
    const { json } = await callAction(UPDATE_TASK_STATUS_ACTION, {
      taskId: TASK_A_ID,
      status: "Done",
    });

    expect(json.error, `update_task_status failed: ${JSON.stringify(json)}`).toBeUndefined();
    expect(json.taskId).toBe(TASK_A_ID);
    expect(json.status).toBe("Done");
    expect(await readTaskStatus(fx.sql, TASK_A_ID)).toBe("Done");
  });

  it("AC-405 update_task_status denies a cross-tenant task and does not persist the change", async () => {
    const before = await readTaskStatus(fx.sql, TASK_B_ID);

    const { json } = await callAction(UPDATE_TASK_STATUS_ACTION, {
      taskId: TASK_B_ID,
      status: "Blocked",
    });

    expect(json.error, `expected cross-tenant denial, got ${JSON.stringify(json)}`).toBeDefined();
    expect(json.error?.code).toBe("42501");
    expect(await readTaskStatus(fx.sql, TASK_B_ID)).toBe(before);
  });
});
