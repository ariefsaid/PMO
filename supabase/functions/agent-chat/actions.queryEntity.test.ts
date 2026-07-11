// AC-CUA-002 (supports) — Slice C, C5d. The agent's own `tasks` read (query_entity) must exclude
// tombstoned rows (a ClickUp-native delete, C3) the same way listTasks/getTask/listMyTasks do
// (C5/C5b/C5c) — an internal hard filter (`tombstoned_at is null`), applied BEFORE any user/model-
// supplied filter, never surfaced as a whitelisted column. A non-task entity control case proves
// the filter never leaks onto other entities.
//
// Deno-native test (no import — assertions are plain `if`/`throw`, no network dependency).
// Verify: deno test --config supabase/functions/agent-chat/deno.json supabase/functions/agent-chat/actions.queryEntity.test.ts

import { runQueryEntity } from './actions.ts';
import type { DeputyContext, ReadQueryBuilder } from '../../../pmo-portal/src/lib/agent/runtime/port.ts';

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(msg ?? `expected ${e}, got ${a}`);
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** Records every builder call in order as ["method", ...args] so a test can assert call ORDER. */
function mockCtx(rows: unknown[]): { ctx: DeputyContext; trace: unknown[][] } {
  const trace: unknown[][] = [];
  const terminal = (): PromiseLike<{ data: unknown[] | null; error: unknown }> =>
    Promise.resolve({ data: rows, error: null });

  function makeBuilder(): ReadQueryBuilder {
    const builder: ReadQueryBuilder = {
      is(column: string, value: null) {
        trace.push(['is', column, value]);
        return builder;
      },
      eq(column: string, value: string) {
        trace.push(['eq', column, value]);
        return Object.assign(terminal(), {
          limit: (n: number) => {
            trace.push(['limit', n]);
            return terminal();
          },
        });
      },
      in(column: string, values: string[]) {
        trace.push(['in', column, values]);
        return {
          limit: (n: number) => {
            trace.push(['limit', n]);
            return terminal();
          },
        };
      },
      limit(n: number) {
        trace.push(['limit', n]);
        return terminal();
      },
    };
    return builder;
  }

  const supabase = {
    from(table: string) {
      trace.push(['from', table]);
      return {
        select(columns: string) {
          trace.push(['select', columns]);
          return makeBuilder();
        },
      };
    },
  };

  const ctx = { jwt: 'j', userId: 'u', orgId: 'o', supabase } as unknown as DeputyContext;
  return { ctx, trace };
}

// runQueryEntity races a 5s setTimeout (READ_TIMEOUT_MS) that is never cleared on the fast-path
// resolution — a pre-existing characteristic of actions.ts, out of this task's scope. Disable the
// resource/op sanitizers on every test below so this real, non-flaky assertion isn't drowned by
// that unrelated timer leak.

Deno.test({
  name: 'AC-CUA-002 query_entity(tasks) applies the internal tombstoned_at is null filter BEFORE the terminal read',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { ctx, trace } = mockCtx([{ id: 't1', name: 'Live task' }]);
    // tasks carries a requiredFilter (project_id, compose-view's R3 rule) — supply it so the read
    // proceeds; the internal tombstone filter is what's under test here, not the requiredFilter gate.
    const res = (await runQueryEntity(
      { entity: 'tasks', columns: ['id', 'name', 'project_id'], filter: { column: 'project_id', op: 'eq', value: 'p1' } },
      ctx,
    )) as { rowCount: number; rows: unknown[] };
    assertEquals(res.rowCount, 1);

    const isCallIndex = trace.findIndex((c) => c[0] === 'is');
    assert(isCallIndex !== -1, 'expected an .is() call in the builder trace');
    assertEquals(trace[isCallIndex], ['is', 'tombstoned_at', null]);
    const limitCallIndex = trace.findIndex((c) => c[0] === 'limit');
    assert(limitCallIndex > isCallIndex, 'expected .is() to precede .limit() (applied before the terminal read)');
  },
});

Deno.test({
  name: 'AC-CUA-002 query_entity(tasks) with a user filter still applies the internal filter first, then the user eq',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { ctx, trace } = mockCtx([{ id: 't1', project_id: 'p1' }]);
    await runQueryEntity(
      { entity: 'tasks', columns: ['id', 'project_id'], filter: { column: 'project_id', op: 'eq', value: 'p1' } },
      ctx,
    );
    const isIdx = trace.findIndex((c) => c[0] === 'is');
    const eqIdx = trace.findIndex((c) => c[0] === 'eq');
    assert(isIdx !== -1, 'expected the internal .is() filter to be applied');
    assert(eqIdx > isIdx, 'expected the internal filter to precede the user-supplied .eq() filter');
    assertEquals(trace[eqIdx], ['eq', 'project_id', 'p1']);
  },
});

Deno.test({
  name: 'AC-CUA-002 control: a non-task entity (projects) never gets the internal filter — no leak',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { ctx, trace } = mockCtx([{ id: 'p1', name: 'Acme Tower' }]);
    const res = (await runQueryEntity({ entity: 'projects', columns: ['id', 'name'] }, ctx)) as {
      rowCount: number;
      rows: unknown[];
    };
    assertEquals(res.rowCount, 1);
    const isCall = trace.find((c) => c[0] === 'is');
    assert(isCall === undefined, `expected no .is() call for a non-task entity, got ${JSON.stringify(isCall)}`);
  },
});
