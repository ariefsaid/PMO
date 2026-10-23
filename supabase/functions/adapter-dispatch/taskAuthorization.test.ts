import { assertEquals } from 'jsr:@std/assert';
import { authorizeClickUpTaskCommand } from './taskAuthorization.ts';

function client(role: string, createdBy: string, projectId = 'project-1', assigneeId: string | null = 'user-1', externallyOwned = false) {
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
        maybeSingle: async () => table === 'tasks'
          ? { data: { org_id: 'org-1', project_id: projectId, created_by: createdBy, assignee_id: assigneeId }, error: null }
          : { data: { id: 'binding-1' }, error: null },
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
