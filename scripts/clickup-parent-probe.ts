/**
 * Live wire-probe: does ClickUp `parent` on create actually make a subtask, and does GET return it?
 *
 * Why: the parent-sync mapping is being built against the ASSUMPTION that (a) POST /list/{id}/task
 * with `parent` creates a subtask in the same List, and (b) GET /task/{id} returns `parent`. Every
 * unit test mocks that. This is the one thing mocks cannot prove — one real round-trip settles it.
 *
 * BUDGET (OD-INT-8): ~5 calls, one pass, everything created is deleted in `finally`. No polling.
 * SECRET HANDLING: token via CLICKUP_TOKEN env, never logged, never in a URL/argv. Responses reduced
 * to the specific fields under test before printing — no task titles or workspace content leak.
 *
 * Usage:
 *   CLICKUP_TOKEN="$(~/.local/bin/op-get.sh clickup-api AS credential)" \
 *     deno run --allow-net --allow-env scripts/clickup-parent-probe.ts
 */
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

let probeListId: string | undefined;
let parentId: string | undefined;
let childId: string | undefined;

try {
  const teamId = (await cu('GET', '/team')).teams?.[0]?.id;
  const spaceId = (await cu('GET', `/team/${teamId}/space`)).spaces?.[0]?.id;
  probeListId = (await cu('POST', `/space/${spaceId}/list`, { name: `pmo-parent-probe ${Date.now()}` })).id;
  console.log('✓ throwaway List created');

  const parent = await cu('POST', `/list/${probeListId}/task`, { name: 'probe-parent' });
  parentId = parent.id;

  // The assumption under test: `parent` on create makes this a subtask.
  const child = await cu('POST', `/list/${probeListId}/task`, { name: 'probe-child', parent: parentId });
  childId = child.id;

  // Read the child back — is `parent` present on a plain GET, and is it the parent id?
  const childGet = await cu('GET', `/task/${childId}`);
  const parentGet = await cu('GET', `/task/${parentId}?include_subtasks=true`);

  console.log('\n── RESULTS ──');
  console.log('child GET has `parent` field:', 'parent' in childGet);
  console.log('child.parent === parentId    :', childGet.parent === parentId);
  console.log('child.list.id === probeList  :', childGet.list?.id === probeListId, '(subtask lives in the same List)');
  console.log('parent GET exposes subtasks[]:', Array.isArray(parentGet.subtasks), '(len', parentGet.subtasks?.length ?? 0, ')');
  console.log('child appears in list default:', undefined, '(checked next)');

  // Does a default list read (subtasks=false) HIDE the child? (read-hygiene passes subtasks=true — confirm why.)
  const listDefault = await cu('GET', `/list/${probeListId}/task`);
  const listWithSub = await cu('GET', `/list/${probeListId}/task?subtasks=true`);
  const inDefault = (listDefault.tasks ?? []).some((t: any) => t.id === childId);
  const inWithSub = (listWithSub.tasks ?? []).some((t: any) => t.id === childId);
  console.log('child in list read (default) :', inDefault, '(expect FALSE — subtasks excluded by default)');
  console.log('child in list read (subtasks):', inWithSub, '(expect TRUE)');
} finally {
  for (const [label, id] of [['child', childId], ['parent', parentId]] as const) {
    if (id) { try { await cu('DELETE', `/task/${id}`); console.log(`✓ ${label} task deleted`); } catch (e) { console.error(`⚠ MANUAL CLEANUP task ${id}`, e); } }
  }
  if (probeListId) { try { await cu('DELETE', `/list/${probeListId}`); console.log('✓ probe List deleted'); } catch (e) { console.error('⚠ MANUAL CLEANUP list', probeListId, e); } }
}
