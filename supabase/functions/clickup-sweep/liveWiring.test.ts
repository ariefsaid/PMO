// [Deno unit] — the SHIPPED clickup-sweep dep bag (`buildSweepDepsLive`) end to end through the real
// `runMultiListSweep` against an in-memory stand-in for the database (the fake replaces ONLY the DB and
// the ClickUp HTTP edge). Binds the live-wiring rules the pure engine's own tests cannot see:
//   • an unrelated inbound change keeps a mapped task's PMO-only status;
//   • a ClickUp task with no parent never flattens a linked PMO subtask;
//   • a ClickUp parent resolves to its mirrored PMO id;
//   • an explicit ClickUp `parent: null` un-nests the mirror;
//   • an adopted subtask is minted with its resolved parent, claim-first;
//   • the invocation's read deadline reaches the reader.
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { buildSweepDepsLive } = await import('./index.ts');
import { runMultiListSweep } from '../../../pmo-portal/src/lib/adapterSeam/clickup/multiListSweep.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const ORG = 'org-1';
const PROJECT = 'proj-a';
const LIST = 'list-a';
type Row = Record<string, unknown>;

function fakeDb(seed: { refs: Row[]; tasks: Row[] }) {
  const tables: Record<string, Row[]> = { external_refs: seed.refs, tasks: seed.tasks, external_sync_watermarks: [] };
  const client = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let op: 'select' | 'update' | 'insert' | 'upsert' = 'select';
      let payload: Row = {};
      const rows = () => (tables[table] ??= []);
      const match = (r: Row) => filters.every(([c, v]) => r[c] === v);
      // deno-lint-ignore no-explicit-any
      const b: any = {
        select: () => b,
        eq: (c: string, v: unknown) => (filters.push([c, v]), b),
        is: (c: string, v: unknown) => (filters.push([c, v]), b),
        or: () => b,
        update: (p: Row) => ((op = 'update'), (payload = p), b),
        insert: (p: Row) => ((op = 'insert'), (payload = p), b),
        upsert: (p: Row) => ((op = 'upsert'), (payload = p), b),
        maybeSingle: () => Promise.resolve({ data: rows().find(match) ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => {
          if (op === 'update') {
            const hit = rows().filter(match);
            hit.forEach((r) => Object.assign(r, payload));
            return resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
          }
          if (op === 'insert') rows().push({ ...payload });
          return resolve({ data: null, error: null });
        },
      };
      return b;
    },
  };
  return { client, tables };
}

function clickUpTask(id: string, extra: Row = {}): Row {
  return { id, name: `Task ${id}`, status: { status: 'to do' }, assignees: [], start_date: null, due_date: null, date_updated: '9000', ...extra };
}

async function sweep(db: ReturnType<typeof fakeDb>, tasks: Row[], pmoOnly = false, readDeadlineAtMs?: number) {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ tasks, last_page: true }), { status: 200 }))) as typeof fetch;
  try {
    const statusMap = {
      pmoToClickUp: { 'To Do': 'to do' },
      clickUpToPmo: { 'to do': 'To Do' },
      defaultPmoStatus: 'To Do',
      ...(pmoOnly ? { pmoOnlyStatuses: ['Blocked'] } : {}),
    };
    const bindings = [{ listId: LIST, projectId: PROJECT, statusMap, memberMap: { pmoToClickUp: {}, clickUpToPmo: {} } }];
    return await runMultiListSweep(buildSweepDepsLive(db.client as never, ORG, 'tok', bindings, readDeadlineAtMs));
  } finally {
    globalThis.fetch = origFetch;
  }
}

const ref = (cu: string, pmo: string): Row => ({ org_id: ORG, domain: 'tasks', external_record_id: cu, pmo_record_id: pmo });
const mirror = (id: string, extra: Row = {}): Row => ({ id, org_id: ORG, project_id: PROJECT, name: 'old', status: 'To Do', source_updated_at: new Date(1000).toISOString(), ...extra });

Deno.test('live sweep keeps a mapped task\'s PMO-only status across an unrelated inbound change', async () => {
  const db = fakeDb({ refs: [ref('cu-1', 'pmo-1')], tasks: [mirror('pmo-1', { status: 'Blocked' })] });
  await sweep(db, [clickUpTask('cu-1', { name: 'Renamed' })], true);
  assert(db.tables.tasks[0].name === 'Renamed', 'the inbound field change applies');
  assert(db.tables.tasks[0].status === 'Blocked', 'the PMO-only status must survive the sync');
});

Deno.test('live sweep: no ClickUp parent leaves the linked PMO parent; a ClickUp parent resolves to its PMO id', async () => {
  const db = fakeDb({
    refs: [ref('cu-1', 'pmo-1'), ref('cu-2', 'pmo-2'), ref('cu-p', 'pmo-p')],
    tasks: [mirror('pmo-1', { parent_task_id: 'pmo-p' }), mirror('pmo-2'), mirror('pmo-p')],
  });
  await sweep(db, [clickUpTask('cu-1'), clickUpTask('cu-2', { parent: 'cu-p' })]);
  assert(db.tables.tasks[0].parent_task_id === 'pmo-p', 'a task with no ClickUp parent must not be flattened');
  assert(db.tables.tasks[1].parent_task_id === 'pmo-p', 'the ClickUp parent resolves to the mirrored PMO task');
});

Deno.test('live sweep adopts a subtask claim-first with its resolved parent', async () => {
  const db = fakeDb({ refs: [ref('cu-p', 'pmo-p')], tasks: [mirror('pmo-p')] });
  await sweep(db, [clickUpTask('cu-new', { parent: 'cu-p' })]);
  const minted = db.tables.tasks.find((t) => t.name === 'Task cu-new');
  assert(!!minted, 'the unmapped task is adopted');
  assert(minted!.parent_task_id === 'pmo-p', 'the adopted subtask carries its resolved parent');
  assert(minted!.project_id === PROJECT, 'it lands in the bound List\'s project');
  assert(db.tables.external_refs.some((r) => r.external_record_id === 'cu-new' && r.pmo_record_id === minted!.id), 'the ref claim is recorded');
});

Deno.test('live sweep: an explicit ClickUp parent: null (un-nested in ClickUp) clears the PMO parent', async () => {
  const db = fakeDb({ refs: [ref('cu-1', 'pmo-1'), ref('cu-p', 'pmo-p')], tasks: [mirror('pmo-1', { parent_task_id: 'pmo-p' }), mirror('pmo-p')] });
  await sweep(db, [clickUpTask('cu-1', { parent: null })]);
  assert(db.tables.tasks[0].parent_task_id === null, 'a task that is top-level in ClickUp must not stay nested in PMO');
});

Deno.test('live sweep: the invocation read deadline reaches the reader (a passed deadline reads and applies nothing)', async () => {
  const db = fakeDb({ refs: [ref('cu-1', 'pmo-1')], tasks: [mirror('pmo-1')] });
  const result = await sweep(db, [clickUpTask('cu-1', { name: 'Renamed' })], false, Date.now() - 1);
  assert(db.tables.tasks[0].name === 'old', 'nothing was read, so nothing applied');
  assert(result.perList[0].incomplete === true, 'the List is reported incomplete');
});
