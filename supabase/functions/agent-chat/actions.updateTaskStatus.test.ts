// Issue #1315 — update_task_status reported success when the database refused the change.
//
// RLS (tasks_update_own_status, migration 0355) silently FILTERS an UPDATE a caller may not
// perform: PostgREST resolves with `data: []`/`data: null` and NO error. The action used to
// treat that as success, so the assistant told an Engineer/Finance user the status was set
// when nothing changed. The action must return the updated row (`.select()`) and report an
// ERROR to the model when no row came back — the model then tells the user the truth.
//
// Deno-native test binding the SHIPPED actions module (`./actions.ts`, the code agent-chat
// executes — same import surface as actions.queryEntity.test.ts; plain if/throw assertions).
// Verify: (cd supabase/functions/agent-chat && deno test --allow-all)

import { updateTaskStatusAction } from './actions.ts';
import type { DeputyContext } from '../../../pmo-portal/src/lib/agent/runtime/port.ts';

function assert(cond: boolean, msg?: string): void {
  if (!cond) throw new Error(msg ?? 'assertion failed');
}

type UpdateOutcome = { data: unknown; error: unknown };

/** DeputyContext whose tasks.update().eq().select() resolves with the configured outcome. */
function ctxWithUpdateOutcome(outcome: UpdateOutcome): { ctx: DeputyContext; selectCalled: () => boolean } {
  let selectCalled = false;
  const supabase = {
    from(table: string) {
      if (table !== 'tasks') throw new Error(`unexpected table ${table}`);
      return {
        update(_patch: object) {
          return {
            eq(_column: string, _value: string) {
              return {
                select() {
                  selectCalled = true;
                  return Promise.resolve(outcome);
                },
              };
            },
          };
        },
      };
    },
  };
  return { ctx: { jwt: 'j', userId: 'u-1', orgId: 'org-1', supabase } as unknown as DeputyContext, selectCalled: () => selectCalled };
}

Deno.test({
  name: '#1315 update_task_status: RLS-refused update (0 rows, no error) → action result is an ERROR, never a success echo',
  fn: async () => {
    const { ctx, selectCalled } = ctxWithUpdateOutcome({ data: [], error: null });
    const res = (await updateTaskStatusAction.run({ taskId: 't-1', status: 'Done' }, ctx)) as Record<string, unknown>;
    assert(selectCalled(), 'action must .select() the updated rows (the refused-write oracle)');
    assert(typeof res.error === 'string' && res.error.length > 0, `expected an error result, got ${JSON.stringify(res)}`);
    assert(!('status' in res) || res.status === undefined, `error result must not echo the new status, got ${JSON.stringify(res)}`);
  },
});

Deno.test({
  name: '#1315 update_task_status: not-found id (data:null, no error) → action result is an ERROR',
  fn: async () => {
    const { ctx } = ctxWithUpdateOutcome({ data: null, error: null });
    const res = (await updateTaskStatusAction.run({ taskId: 'missing', status: 'Done' }, ctx)) as Record<string, unknown>;
    assert(typeof res.error === 'string' && res.error.length > 0, `expected an error result, got ${JSON.stringify(res)}`);
  },
});

Deno.test({
  name: '#1315 update_task_status: permitted user (row updated) → success result carries taskId + the new status',
  fn: async () => {
    const { ctx } = ctxWithUpdateOutcome({ data: [{ id: 't-1', status: 'Done' }], error: null });
    const res = (await updateTaskStatusAction.run({ taskId: 't-1', status: 'Done' }, ctx)) as Record<string, unknown>;
    assert(res.error === undefined, `permitted update must not error, got ${JSON.stringify(res)}`);
    assert(res.taskId === 't-1' && res.status === 'Done', `expected success echo, got ${JSON.stringify(res)}`);
  },
});

Deno.test({
  name: '#1315 control: a real db error still surfaces as the db-error result (guard does not mask it)',
  fn: async () => {
    const { ctx } = ctxWithUpdateOutcome({ data: null, error: { code: '42501' } });
    const res = (await updateTaskStatusAction.run({ taskId: 't-1', status: 'Done' }, ctx)) as Record<string, unknown>;
    assert(res.error === 'update_task_status db error', `expected the db-error result, got ${JSON.stringify(res)}`);
  },
});
