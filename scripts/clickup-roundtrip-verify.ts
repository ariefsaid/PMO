/**
 * LIVE round-trip proof for the ClickUp sync mapping — the completion gate for single-org (OD-INT-14).
 *
 * Every other ClickUp test mocks `globalThis.fetch`. Those prove our handlers behave correctly GIVEN
 * an assumed payload; they cannot prove the assumption. This drives the **SHIPPED** mapping functions
 * (imported from `pmo-portal/src/lib/adapterSeam/clickup/mapping.ts` — never a copy) against the REAL
 * ClickUp API and asserts a full PMO -> ClickUp -> PMO round-trip, including the `parent` link.
 *
 * BUDGET (OD-INT-8): one pass, ~9 calls, no polling. Everything created is deleted in `finally`.
 * SECRETS: token via CLICKUP_TOKEN env — never logged, never in a URL or argv. Output is reduced to
 * assertions; no workspace content is printed.
 *
 * Usage:
 *   CLICKUP_TOKEN="$(~/.local/bin/op-get.sh clickup-api AS credential)" \
 *     deno run --allow-net --allow-env --allow-read scripts/clickup-roundtrip-verify.ts
 */
import {
  pmoTaskToClickUpBody,
  clickUpTaskToPmoRecord,
} from '../pmo-portal/src/lib/adapterSeam/clickup/mapping.ts';
import { buildClickUpStatusMap } from '../pmo-portal/src/lib/adapterSeam/clickup/statusMapBuilder.ts';
import type { ClickUpMemberMap } from '../pmo-portal/src/lib/adapterSeam/clickup/memberMap.ts';

const API = 'https://api.clickup.com/api/v2';
const token = Deno.env.get('CLICKUP_TOKEN');
if (!token) { console.error('✗ CLICKUP_TOKEN not set'); Deno.exit(1); }

async function cu(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: token!, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

const results: Array<{ check: string; pass: boolean; detail?: string }> = [];
const assert = (check: string, pass: boolean, detail = '') => {
  results.push({ check, pass, detail });
  console.log(`${pass ? '✓' : '✗'} ${check}${detail ? ` — ${detail}` : ''}`);
};

let listId: string | undefined;
const created: string[] = [];

try {
  const teamId = (await cu('GET', '/team')).teams?.[0]?.id;
  const spaceId = (await cu('GET', `/team/${teamId}/space`)).spaces?.[0]?.id;
  listId = (await cu('POST', `/space/${spaceId}/list`, { name: `pmo-roundtrip ${Date.now()}` })).id;

  // Build the status map the SAME way external-link does at link time (OD-INT-13).
  const list = await cu('GET', `/list/${listId}`);
  const statusMap = buildClickUpStatusMap(list.statuses ?? []);
  const memberMap: ClickUpMemberMap = { pmoToClickUp: {}, clickUpToPmo: {} };
  const maps = { statusMap, memberMap };

  assert(
    'OD-INT-13: the real List resolves all four PMO statuses',
    ['To Do', 'In Progress', 'Done', 'Blocked'].every(
      (s) => statusMap.pmoToClickUp[s] !== undefined || (statusMap.pmoOnlyStatuses ?? []).includes(s),
    ),
    `Blocked => ${(statusMap.pmoOnlyStatuses ?? []).includes('Blocked') ? 'pmo-only' : statusMap.pmoToClickUp['Blocked']}`,
  );

  // ── PMO -> ClickUp (parent) via the SHIPPED body mapper ──────────────────────────────────────
  const parentBody = pmoTaskToClickUpBody(
    { id: 'pmo-parent', name: 'roundtrip-parent', status: 'To Do', assignee_id: null },
    maps,
    { mode: 'create' },
  );
  const cuParent = await cu('POST', `/list/${listId}/task`, parentBody);
  created.push(cuParent.id);
  assert('outbound: shipped mapper create body accepted by the real API', !!cuParent.id);

  // ── PMO -> ClickUp (child WITH parent) ───────────────────────────────────────────────────────
  const childBody = pmoTaskToClickUpBody(
    { id: 'pmo-child', name: 'roundtrip-child', status: 'In Progress', assignee_id: null, parent_task_id: 'pmo-parent' },
    maps,
    { mode: 'create', parentClickUpId: cuParent.id },
  );
  assert('outbound: parent resolved into the create body', (childBody as any).parent === cuParent.id);
  const cuChild = await cu('POST', `/list/${listId}/task`, childBody);
  created.push(cuChild.id);

  // ── ClickUp -> PMO via the SHIPPED inbound mapper ────────────────────────────────────────────
  const childRaw = await cu('GET', `/task/${cuChild.id}`);
  const backParentUnresolved = clickUpTaskToPmoRecord(childRaw, maps);
  assert(
    'inbound: an UNRESOLVABLE parent leaves parent_task_id null and does NOT drop the row',
    backParentUnresolved.parent_task_id == null && backParentUnresolved.name === 'roundtrip-child',
  );

  const backResolved = clickUpTaskToPmoRecord(childRaw, maps, undefined, 'pmo-parent');
  assert(
    'inbound: a RESOLVED parent maps onto parent_task_id',
    backResolved.parent_task_id === 'pmo-parent',
    `got ${String(backResolved.parent_task_id)}`,
  );

  assert('round-trip: name survives PMO -> ClickUp -> PMO', backParentUnresolved.name === 'roundtrip-child');
  assert(
    'round-trip: status survives via the derived map',
    backParentUnresolved.status === 'In Progress',
    `got ${backParentUnresolved.status}`,
  );
  assert('live: ClickUp reports the child as a subtask of the parent', childRaw.parent === cuParent.id);
} finally {
  for (const id of created.reverse()) {
    try { await cu('DELETE', `/task/${id}`); } catch (e) { console.error('⚠ MANUAL CLEANUP task', id, e); }
  }
  if (listId) { try { await cu('DELETE', `/list/${listId}`); } catch (e) { console.error('⚠ MANUAL CLEANUP list', listId, e); } }
  console.log('✓ all probe artifacts deleted');
  const failed = results.filter((r) => !r.pass);
  console.log(`\n── ${results.length - failed.length}/${results.length} checks passed ──`);
  if (failed.length) Deno.exit(1);
}
