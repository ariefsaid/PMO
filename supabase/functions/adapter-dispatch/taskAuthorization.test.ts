import { assertEquals } from 'jsr:@std/assert';
import { authorizeClickUpTaskCommand } from './taskAuthorization.ts';

function client(role: string, createdBy: string, projectId = 'project-1', assigneeId: string | null = 'user-1', externallyOwned = false, parentTaskId: string | null = null, others: Record<string, unknown> = {}) {
  const filters = new Map<string, string>();
  return {
    async rpc(name: string) {
      if (name === 'actor_authorization_state') return { data: { role, active: true }, error: null };
      if (name === 'task_domain_externally_owned') return { data: externallyOwned, error: null };
      throw new Error(`unexpected rpc ${name}`);
    },
    from(table: string) {
      const query: Record<string, unknown> = {};
      const builder = {
        select: (_columns: string) => builder,
        eq: (key: string, value: string) => { filters.set(key, value); return builder; },
        is: (key: string, value: null) => { filters.set(key, String(value)); return builder; },
        maybeSingle: async () => {
          const other = others[`${table}:${filters.get('id')}`];
          if (other !== undefined) return { data: other, error: null };
          return table === 'tasks'
            ? { data: { org_id: 'org-1', project_id: projectId, created_by: createdBy, assignee_id: assigneeId, parent_task_id: parentTaskId }, error: null }
            : { data: { id: 'binding-1' }, error: null };
        },
      };
      return builder;
    },
  };
}

const command = (operation: string, project_id = 'project-1') => ({
  domain: 'tasks', operation, record: { id: 'task-1', ...(project_id ? { project_id } : {}) },
}) as never;

Deno.test('AC-SEC-A1 refuses unauthorized task edits before any upstream request', async () => {
    const originalFetch = globalThis.fetch;
    let upstreamCalls = 0;
    const upstream = async () => { upstreamCalls += 1; return new Response(null); };
    globalThis.fetch = upstream as typeof fetch;
    try {
      const result = await authorizeClickUpTaskCommand(client('Engineer', 'another-user') as never,
        'org-1', 'user-1', command('update'));
      assertEquals(result.ok, false);
      assertEquals(upstreamCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
});

Deno.test('AC-SEC-A1 task status authorization follows the assignee rule', async () => {
  const allowed = await authorizeClickUpTaskCommand(client('Engineer', 'another-user', 'project-1', 'user-1') as never,
    'org-1', 'user-1', command('transition', ''));
  const denied = await authorizeClickUpTaskCommand(client('Engineer', 'another-user', 'project-1', 'someone-else') as never,
    'org-1', 'user-1', command('transition'));
  assertEquals(allowed.ok, true);
  assertEquals(denied.ok, false);
});

Deno.test('AC-SEC-A1 allows a permitted new task in an active project binding', async () => {
  const result = await authorizeClickUpTaskCommand(client('Engineer', 'user-1') as never,
    'org-1', 'user-1', command('create'));
  assertEquals(result.ok, true);
});

Deno.test('AC-SEC-A2 creator cannot edit an externally owned task', async () => {
  const denied = await authorizeClickUpTaskCommand(client('Engineer', 'user-1', 'project-1', 'user-1', true) as never,
    'org-1', 'user-1', command('update'));
  assertEquals(denied.ok, false);
  const allowed = await authorizeClickUpTaskCommand(client('Engineer', 'user-1', 'project-1', 'user-1', false) as never,
    'org-1', 'user-1', command('update'));
  assertEquals(allowed.ok, true);
});

Deno.test('refuses a substituted project before resolving an integration binding', async () => {
    const result = await authorizeClickUpTaskCommand(client('Admin', 'another-user') as never,
      'org-1', 'user-1', command('update', 'project-2'));
    assertEquals(result, { ok: false, message: 'task project does not match' });
});

Deno.test('AC-TASK-FIN-001 Finance creates and moves its own assigned tasks on a ClickUp project, like an Engineer', async () => {
  const created = await authorizeClickUpTaskCommand(client('Finance', 'user-1') as never,
    'org-1', 'user-1', command('create'));
  const moved = await authorizeClickUpTaskCommand(client('Finance', 'another-user', 'project-1', 'user-1') as never,
    'org-1', 'user-1', command('transition'));
  const othersTask = await authorizeClickUpTaskCommand(client('Finance', 'another-user', 'project-1', 'someone-else') as never,
    'org-1', 'user-1', command('transition'));
  const othersEdit = await authorizeClickUpTaskCommand(client('Finance', 'another-user') as never,
    'org-1', 'user-1', command('update'));
  assertEquals(created.ok, true);
  assertEquals(moved.ok, true);
  assertEquals(othersTask.ok, false);
  assertEquals(othersEdit.ok, false);
});

// ── T-07 B2 · placement is validated BEFORE ClickUp is changed ───────────────────────────────────────
const placement = (operation: string, extra: Record<string, unknown>) =>
  ({ domain: 'tasks', operation, record: { id: 'task-1', project_id: 'project-1', ...extra } }) as never;
const run = (cmd: never, parentTaskId: string | null = null, others: Record<string, unknown> = {}) =>
  authorizeClickUpTaskCommand(client('Admin', 'x', 'project-1', 'user-1', true, parentTaskId, others) as never, 'org-1', 'user-1', cmd);

Deno.test('a parent in the same project is accepted on create and update', async () => {
  const others = { 'tasks:p-ok': { id: 'p-ok', project_id: 'project-1' } };
  assertEquals((await run(placement('create', { parent_task_id: 'p-ok' }), null, others)).ok, true);
  assertEquals((await run(placement('update', { parent_task_id: 'p-ok' }), null, others)).ok, true);
});

Deno.test('a parent from another project, a missing parent and a self-parent are refused (422) before any ClickUp call', async () => {
  const others = { 'tasks:p-other': { id: 'p-other', project_id: 'project-2' } };
  for (const parent_task_id of ['p-other', 'p-missing', 'task-1']) {
    const result = await run(placement('update', { parent_task_id }), null, { ...others, 'tasks:p-missing': null });
    assertEquals(result.ok, false, `${parent_task_id} must be refused`);
    assertEquals((result as { status?: number }).status, 422);
  }
});

Deno.test('a parent whose project cannot be read is refused (fail closed)', async () => {
  const result = await run(placement('create', { parent_task_id: 'p-null-project' }), null, { 'tasks:p-null-project': { id: 'p-null-project', project_id: null } });
  assertEquals(result.ok, false);
});

Deno.test('a phase from another project is refused; one in the project is accepted', async () => {
  const others = { 'project_milestones:m-other': { id: 'm-other', project_id: 'project-2' }, 'project_milestones:m-ok': { id: 'm-ok', project_id: 'project-1' } };
  assertEquals((await run(placement('update', { milestone_id: 'm-other' }), null, others)).ok, false);
  assertEquals((await run(placement('update', { milestone_id: 'm-ok' }), null, others)).ok, true);
});

Deno.test('clearing the parent of a subtask is refused (ClickUp cannot un-nest); clearing a task with no parent is a no-op', async () => {
  const refused = await run(placement('update', { parent_task_id: null }), 'p-stored');
  assertEquals(refused.ok, false);
  assertEquals((refused as { status?: number }).status, 422);
  assertEquals((await run(placement('update', { parent_task_id: null }), null)).ok, true);
});

Deno.test('a transition is not placement-checked (the writer ignores placement keys on a transition)', async () => {
  assertEquals((await run(placement('transition', { parent_task_id: 'p-missing', milestone_id: 'm-missing' }), 'p-stored', { 'tasks:p-missing': null })).ok, true);
});
