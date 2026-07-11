import { createClickUpAdapter } from '../pmo-portal/src/lib/adapterSeam/clickup/adapter.ts';
import { ClickUpRateLimiter, withBackoff, type ClickUpLanePriority } from '../pmo-portal/src/lib/adapterSeam/clickup/rateLimit.ts';
import type { AdapterCommand } from '../pmo-portal/src/lib/adapterSeam/contract.ts';
import type { ClickUpMemberMap } from '../pmo-portal/src/lib/adapterSeam/clickup/memberMap.ts';
import type { ClickUpStatusMap } from '../pmo-portal/src/lib/adapterSeam/clickup/statusMap.ts';

type SmokeCheck = { name: string; pass: boolean; details: string[] };

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

type ClickUpResponse = {
  status: number;
  headers: Headers;
  body: Json | null;
  rawText: string;
};

const token = process.env.CLICKUP_API_TOKEN;
const baseUrl = process.env.CLICKUP_API_BASE_URL ?? 'https://api.clickup.com/api/v2';
const sandboxPrefix = `pmo-smoke-${Date.now()}`;
const sandboxTaskName = `${sandboxPrefix}-task`;
const webhookEndpoint = `https://example.com/${sandboxPrefix}-webhook`;

if (!token) {
  console.error('FAIL: CLICKUP_API_TOKEN is not set');
  process.exit(1);
}

const rateLimiter = new ClickUpRateLimiter();
const externalIds = new Map<string, string>();
const assigneeState = new Map<string, number[]>();
const checks: SmokeCheck[] = [];
const shapeDiffs: string[] = [];
const adapterBugs: string[] = [];
const cleanupNotes: string[] = [];

let sandboxListId: string | null = null;
let sandboxTaskId: string | null = null;
let sandboxWebhookId: string | null = null;
let sandboxSpaceId: string | null = null;
let teamId: string | null = null;

let taskCreateRaw: Json | null = null;
let taskGetRaw: Json | null = null;
let taskUpdateRaw: Json | null = null;
let taskListRaw: Json | null = null;
let taskDeleteGetRaw: Json | null = null;
let listCreateRaw: Json | null = null;
let webhookCreateShape: Json | null = null;

function addCheck(name: string, pass: boolean, details: string[]): void {
  checks.push({ name, pass, details });
}

async function request(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  opts: { body?: Json; priority?: ClickUpLanePriority } = {},
): Promise<ClickUpResponse> {
  await rateLimiter.acquire(opts.priority ?? 'bulk');
  const res = await withBackoff(() =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: token!,
        'Content-Type': 'application/json',
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
  );
  const rawText = res.status === 204 ? '' : await res.text();
  let body: Json | null = null;
  if (rawText) {
    try {
      body = JSON.parse(rawText) as Json;
    } catch {
      body = null;
    }
  }
  return { status: res.status, headers: res.headers, body, rawText };
}

function requireObject(value: Json | null, context: string): Record<string, Json> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} did not return an object`);
  }
  return value as Record<string, Json>;
}

function readString(value: Json | undefined, context: string): string {
  if (typeof value !== 'string') throw new Error(`${context} was not a string`);
  return value;
}

function readNumber(value: Json | undefined, context: string): number {
  if (typeof value !== 'number') throw new Error(`${context} was not a number`);
  return value;
}

function readArray(value: Json | undefined, context: string): Json[] {
  if (!Array.isArray(value)) throw new Error(`${context} was not an array`);
  return value;
}

function isoFromNow(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function chooseStatuses(list: Record<string, Json>): ClickUpStatusMap {
  const statuses = readArray(list.statuses, 'list.statuses').map((item) => requireObject(item as Json, 'list.statuses[]'));
  const open = statuses.find((status) => status.type === 'open') ?? statuses[0];
  const closed = statuses.find((status) => status.type === 'closed') ?? statuses.at(-1);
  if (!open || !closed) throw new Error('could not resolve real list statuses');
  const openName = readString(open.status, 'open.status');
  const closedName = readString(closed.status, 'closed.status');
  return {
    pmoToClickUp: { 'To Do': openName, Done: closedName },
    clickUpToPmo: { [openName]: 'To Do', [closedName]: 'Done' },
    defaultPmoStatus: 'To Do',
  };
}

function memberMapFromTeam(team: Record<string, Json>): { map: ClickUpMemberMap; memberIds: number[] } {
  const members = readArray(team.members, 'team.members').map((item) => requireObject(item as Json, 'team.members[]'));
  const ids = members
    .map((member) => requireObject(member.user as Json, 'team.members[].user'))
    .map((user) => readNumber(user.id, 'team.members[].user.id'));
  const pmoToClickUp: Record<string, number> = {};
  const clickUpToPmo: Record<number, string> = {};
  ids.forEach((id) => {
    const pmoId = String(id);
    pmoToClickUp[pmoId] = id;
    clickUpToPmo[id] = pmoId;
  });
  return { map: { pmoToClickUp, clickUpToPmo }, memberIds: ids };
}

function shapeOf(value: Json | undefined): Json {
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.length === 0 ? ['<empty-array>'] : [shapeOf(value[0] as Json)];
  if (typeof value === 'object') {
    const out: Record<string, Json> = {};
    for (const key of Object.keys(value).sort()) out[key] = shapeOf((value as Record<string, Json>)[key]);
    return out;
  }
  return typeof value;
}

function diffShapes(expected: Json, actual: Json, path = '$'): string[] {
  const diffs: string[] = [];
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      diffs.push(`${path}: expected array, got ${typeof actual}`);
      return diffs;
    }
    if (expected.length > 0 && actual.length > 0) {
      diffs.push(...diffShapes(expected[0] as Json, actual[0] as Json, `${path}[]`));
    }
    return diffs;
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
      diffs.push(`${path}: expected object, got ${actual === null ? 'null' : Array.isArray(actual) ? 'array' : typeof actual}`);
      return diffs;
    }
    const expectedObject = expected as Record<string, Json>;
    const actualObject = actual as Record<string, Json>;
    for (const key of Object.keys(expectedObject)) {
      if (!(key in actualObject)) diffs.push(`${path}.${key}: missing in real response`);
      else diffs.push(...diffShapes(expectedObject[key], actualObject[key], `${path}.${key}`));
    }
    for (const key of Object.keys(actualObject)) {
      if (!(key in expectedObject)) diffs.push(`${path}.${key}: extra in real response`);
    }
    return diffs;
  }
  if (expected !== actual) diffs.push(`${path}: expected ${String(expected)}, got ${String(actual)}`);
  return diffs;
}

function captureShapeDiff(name: string, mockedFixture: Json, realBody: Json | null): void {
  if (realBody === null) {
    shapeDiffs.push(`${name}: real response body was null`);
    return;
  }
  const diffs = diffShapes(shapeOf(mockedFixture), shapeOf(realBody));
  if (diffs.length === 0) shapeDiffs.push(`${name}: no shape drift vs mocked fixture`);
  else diffs.forEach((diff) => shapeDiffs.push(`${name}: ${diff}`));
}

async function cleanup(): Promise<void> {
  if (sandboxWebhookId) {
    const res = await request('DELETE', `/webhook/${sandboxWebhookId}`);
    cleanupNotes.push(`webhook delete ${res.status}`);
    sandboxWebhookId = null;
  }
  if (sandboxTaskId) {
    const res = await request('DELETE', `/task/${sandboxTaskId}`);
    cleanupNotes.push(`task delete ${res.status}`);
    sandboxTaskId = null;
  }
  if (sandboxListId) {
    const res = await request('DELETE', `/list/${sandboxListId}`);
    cleanupNotes.push(`list delete ${res.status}`);
    sandboxListId = null;
  }
  if (sandboxSpaceId) {
    const listsRes = await request('GET', `/space/${sandboxSpaceId}/list`);
    const lists = readArray(requireObject(listsRes.body, 'space list response').lists, 'space.lists');
    const leftovers = lists
      .map((item) => requireObject(item as Json, 'space.lists[]'))
      .map((list) => readString(list.name, 'list.name'))
      .filter((name) => name.startsWith('pmo-smoke-'));
    addCheck('6. Cleanup', leftovers.length === 0, [...cleanupNotes, leftovers.length === 0 ? 'no pmo-smoke-* lists remain' : `leftover lists: ${leftovers.join(', ')}`]);
  }
}

async function main(): Promise<void> {
  try {
    const auth = await request('GET', '/user', { priority: 'interactive' });
    const authPass =
      auth.status === 200 &&
      auth.headers.has('x-ratelimit-limit') &&
      auth.headers.has('x-ratelimit-remaining') &&
      auth.headers.has('x-ratelimit-reset');
    addCheck('1. Token valid', authPass, [
      `GET /user status ${auth.status}`,
      `rate headers present: ${String(auth.headers.has('x-ratelimit-limit') && auth.headers.has('x-ratelimit-remaining') && auth.headers.has('x-ratelimit-reset'))}`,
    ]);
    if (auth.status !== 200) return;

    const teamsRes = await request('GET', '/team');
    const teams = readArray(requireObject(teamsRes.body, 'team response').teams, 'teams');
    const team = requireObject(teams[0] as Json, 'teams[0]');
    teamId = readString(team.id, 'team.id');

    const spacesRes = await request('GET', `/team/${teamId}/space`);
    const spaces = readArray(requireObject(spacesRes.body, 'space response').spaces, 'spaces');
    const space = requireObject((spaces.find((entry) => requireObject(entry as Json, 'space').archived !== true) ?? spaces[0]) as Json, 'space');
    sandboxSpaceId = readString(space.id, 'space.id');

    const listCreate = await request('POST', `/space/${sandboxSpaceId}/list`, {
      body: { name: sandboxPrefix },
      priority: 'interactive',
    });
    if (listCreate.status < 200 || listCreate.status >= 300) {
      addCheck('2. Discover team+space; create sandbox list', false, [
        `team ${teamId}`,
        `space ${sandboxSpaceId}`,
        `create list status ${listCreate.status}`,
      ]);
      return;
    }
    listCreateRaw = listCreate.body;
    sandboxListId = readString(requireObject(listCreate.body, 'create list body').id, 'created list id');

    const listDetailRes = await request('GET', `/list/${sandboxListId}`);
    const listDetail = requireObject(listDetailRes.body, 'list detail body');
    const statusMap = chooseStatuses(listDetail);
    const { map: memberMap, memberIds } = memberMapFromTeam(team);
    addCheck('2. Discover team+space; create sandbox list', true, [
      `team ${teamId}`,
      `space ${sandboxSpaceId}`,
      `list ${sandboxListId}`,
      `statuses mapped: To Do -> ${statusMap.pmoToClickUp['To Do']}, Done -> ${statusMap.pmoToClickUp.Done}`,
      `team members discovered: ${memberIds.length}`,
    ]);

    const pmoRecordId = 'pmo-smoke-record';
    const primaryAssignee = memberIds[0];
    const secondaryAssignee = memberIds[1] ?? null;

    const adapter = createClickUpAdapter({
      fetchImpl: fetch,
      token,
      baseUrl,
      listId: sandboxListId,
      statusMap,
      memberMap,
      rateLimiter,
      resolveExternalId: async (pmoId: string) => {
        const externalId = externalIds.get(pmoId);
        if (!externalId) throw new Error(`no external id recorded for ${pmoId}`);
        return externalId;
      },
      resolvePreviousAssigneeIds: async (pmoId: string) => assigneeState.get(pmoId) ?? [],
    });

    const createCommand: AdapterCommand = {
      domain: 'tasks',
      operation: 'create',
      record: {
        id: pmoRecordId,
        name: sandboxTaskName,
        status: 'To Do',
        assignee_id: primaryAssignee ? String(primaryAssignee) : null,
      },
    };
    const created = await adapter.commit(createCommand);
    externalIds.set(pmoRecordId, created.externalRecordId);
    sandboxTaskId = created.externalRecordId;
    assigneeState.set(pmoRecordId, primaryAssignee ? [primaryAssignee] : []);
    const createGetRes = await request('GET', `/task/${created.externalRecordId}`);
    taskCreateRaw = createGetRes.body;

    const fetched = await adapter.getByExternalId('tasks', created.externalRecordId);
    if (!fetched) throw new Error('adapter.getByExternalId returned null for created task');
    taskGetRaw = createGetRes.body;

    const updatedName = `${sandboxTaskName}-renamed`;
    const updatedStart = isoFromNow(86_400_000);
    const updatedEnd = isoFromNow(172_800_000);
    await adapter.commit({
      domain: 'tasks',
      operation: 'update',
      record: {
        id: pmoRecordId,
        name: updatedName,
        start_date: updatedStart,
        end_date: updatedEnd,
      },
    });

    await adapter.commit({
      domain: 'tasks',
      operation: 'transition',
      record: {
        id: pmoRecordId,
        status: 'Done',
      },
    });

    const nextAssigneeIds = secondaryAssignee ? [secondaryAssignee] : [];
    await adapter.commit({
      domain: 'tasks',
      operation: 'update',
      record: {
        id: pmoRecordId,
        assignee_id: secondaryAssignee ? String(secondaryAssignee) : null,
      },
    });
    assigneeState.set(pmoRecordId, nextAssigneeIds);

    const finalGetRes = await request('GET', `/task/${created.externalRecordId}`);
    const finalTask = requireObject(finalGetRes.body, 'final task body');
    taskUpdateRaw = finalGetRes.body;
    const dateUpdated = readString(finalTask.date_updated, 'final task date_updated');

    const page = await adapter.listChangesSinceWatermark('tasks', dateUpdated);
    const rawPage = await request('GET', `/list/${sandboxListId}/task?order_by=updated&date_updated_gt=${Math.max(0, Number(dateUpdated) - 1)}&page=0`);
    taskListRaw = rawPage.body;
    const changeFound = page.changes.some((change) => change.id === created.externalRecordId);
    if (!changeFound) {
      adapterBugs.push('listChangesSinceWatermark did not include a task updated exactly at the cursor boundary');
    }

    await adapter.commit({
      domain: 'tasks',
      operation: 'delete',
      record: { id: pmoRecordId },
    });
    assigneeState.delete(pmoRecordId);
    externalIds.delete(pmoRecordId);
    sandboxTaskId = null;

    const deletedGetRes = await request('GET', `/task/${created.externalRecordId}`);
    taskDeleteGetRaw = deletedGetRes.body;
    const deletedVerified = deletedGetRes.status === 404 || requireObject(deletedGetRes.body, 'deleted get body').deleted === true;
    if (deletedGetRes.status !== 404) {
      adapterBugs.push('getByExternalId only treats 404 as deleted; live API may also surface deleted records differently');
    }

    addCheck('3. Through the adapter', fetched.name === sandboxTaskName && changeFound && deletedVerified, [
      `create external id ${created.externalRecordId}`,
      `getByExternalId returned ${fetched.name}`,
      `update applied name ${String(finalTask.name)}`,
      `transition applied status ${(requireObject(finalTask.status as Json, 'finalTask.status').status as string)}`,
      `assignee update branch used ${secondaryAssignee ? '{add,rem}' : '{rem-only}'}`,
      `listChangesSinceWatermark cursor ${dateUpdated} included task: ${String(changeFound)}`,
      `delete verify status ${deletedGetRes.status}`,
    ]);

    const webhookCreateRes = await request('POST', `/team/${teamId}/webhook`, {
      body: { endpoint: webhookEndpoint, events: ['taskCreated'] },
      priority: 'interactive',
    });
    if (webhookCreateRes.status >= 200 && webhookCreateRes.status < 300) {
      const webhookBody = requireObject(webhookCreateRes.body, 'webhook create body');
      const webhook = requireObject(webhookBody.webhook as Json, 'webhook create body.webhook');
      sandboxWebhookId = readString(webhookBody.id, 'webhook id');
      const secretPresent = typeof webhook.secret === 'string' && (webhook.secret as string).length > 0;
      webhookCreateShape = { ...webhookBody, webhook: { ...webhook, secret: '<redacted>' } };
      addCheck('4. Webhook provisioning', secretPresent, [
        `create webhook status ${webhookCreateRes.status}`,
        `secret present: ${String(secretPresent)}`,
      ]);
      if (!secretPresent) adapterBugs.push('webhook create did not return a non-empty secret');
      const webhookDeleteRes = await request('DELETE', `/webhook/${sandboxWebhookId}`, { priority: 'interactive' });
      sandboxWebhookId = null;
      if (webhookDeleteRes.status < 200 || webhookDeleteRes.status >= 300) {
        addCheck('4. Webhook provisioning', false, [
          `create webhook status ${webhookCreateRes.status}`,
          `delete webhook status ${webhookDeleteRes.status}`,
        ]);
      }
    } else {
      addCheck('4. Webhook provisioning', false, [`create webhook status ${webhookCreateRes.status}`]);
    }

    captureShapeDiff('create list vs onboarding.test create-list fixture', { id: 'list-new', name: 'My Project' }, listCreateRaw);
    const mockedTaskFixture = {
      id: 'cu-task-1',
      name: 'Wire the widget',
      status: { status: 'to do' },
      assignees: [{ id: 111 }],
      start_date: null,
      due_date: null,
      date_updated: '1700000000000',
    };
    captureShapeDiff('task create/get vs mocked ClickUp task fixture', mockedTaskFixture, taskCreateRaw);
    captureShapeDiff('task final get vs mocked ClickUp task fixture', mockedTaskFixture, taskUpdateRaw);
    captureShapeDiff('list page vs reads.test fixture', { tasks: [mockedTaskFixture], last_page: true }, taskListRaw);
    captureShapeDiff('deleted task 404 vs reads.test 404 fixture', { err: 'Task not found' }, taskDeleteGetRaw);
    if (webhookCreateShape) {
      shapeDiffs.push('webhook create response: no existing mocked fixture in clickup tests to compare against');
    }
    addCheck('5. Shape diff', true, [`${shapeDiffs.length} shape-diff notes captured`]);
  } finally {
    await cleanup();
  }

  console.log('ClickUp live smoke report');
  for (const check of checks) {
    console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}`);
    for (const detail of check.details) console.log(`  - ${detail}`);
  }
  console.log('Shape diff');
  for (const diff of shapeDiffs) console.log(`  - ${diff}`);
  console.log('Adapter bugs');
  if (adapterBugs.length === 0) console.log('  - none');
  else for (const bug of adapterBugs) console.log(`  - ${bug}`);
}

main().catch((error) => {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
