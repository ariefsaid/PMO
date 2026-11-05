import { assertEquals, assertRejects } from '@std/assert';
import { describe, it } from '@std/testing/bdd';
import { hasUnsettledBudgetArchiveCancellation } from './budgetDispatch.ts';

type Row = Record<string, unknown>;

class Query {
  private readonly filters: Array<[string, string, unknown]> = [];
  private after: string | null = null;
  private take = Number.POSITIVE_INFINITY;

  constructor(
    private readonly table: string,
    private readonly rows: Record<string, Row[]>,
    private readonly failTable?: string,
  ) {}

  select(): this { return this; }
  eq(column: string, value: unknown): this { this.filters.push([column, 'eq', value]); return this; }
  neq(column: string, value: unknown): this { this.filters.push([column, 'neq', value]); return this; }
  filter(column: string, op: string, value: unknown): this { this.filters.push([column, op, value]); return this; }
  gt(column: string, value: unknown): this {
    if (column === 'id') this.after = String(value);
    return this;
  }
  order(): this { return this; }
  limit(value: number): this { this.take = value; return this; }

  then(resolve: (value: { data: Row[] | null; error: { message: string } | null }) => unknown,
    reject?: (reason: unknown) => unknown): Promise<unknown> {
    if (this.table === this.failTable) return Promise.resolve({ data: null, error: { message: 'read failed' } }).then(resolve, reject);
    const data = (this.rows[this.table] ?? []).filter((row) => {
      if (this.after !== null && String(row.id) <= this.after) return false;
      return this.filters.every(([column, op, value]) => {
        const actual = column === 'payload->>budget_archive_cancel_job_id'
          ? row.budget_archive_cancel_job_id
          : row[column];
        return op === 'eq' ? actual === value : actual !== value;
      });
    }).slice(0, this.take);
    return Promise.resolve({ data, error: null }).then(resolve, reject);
  }
}

function client(rows: Record<string, Row[]>, failTable?: string) {
  const scopedRows = {
    ...rows,
    budget_archive_cancel_intents: (rows.budget_archive_cancel_intents ?? []).map((row) => ({
      org_id: 'org-1', project_id: 'project-1', ...row,
    })),
    external_command_outbox: (rows.external_command_outbox ?? []).map((row) => ({
      org_id: 'org-1', domain: 'budget', operation: 'create', ...row,
    })),
  };
  return {
    from(table: string) { return new Query(table, scopedRows, failTable); },
  } as never;
}

describe('range budget cancellation fence', () => {
  it('waits on a pending or held cancellation', async () => {
    for (const state of ['pending', 'held']) {
      const result = await hasUnsettledBudgetArchiveCancellation(client({
        budget_archive_cancel_intents: [{ id: 'intent-1', state }],
      }), 'org-1', 'project-1');
      assertEquals(result, true, `${state} cancellation must keep range units pending`);
    }
  });

  it('treats superseded as settled only when positive absence proves no cancellation command was issued', async () => {
    const result = await hasUnsettledBudgetArchiveCancellation(client({
      budget_archive_cancel_intents: [{ id: 'intent-1', state: 'superseded' }],
      external_command_outbox: [],
    }), 'org-1', 'project-1');
    assertEquals(result, false);
  });

  it('keeps a superseded cancellation fenced when any archive outbox command exists', async () => {
    const result = await hasUnsettledBudgetArchiveCancellation(client({
      budget_archive_cancel_intents: [{ id: 'intent-1', state: 'superseded' }],
      external_command_outbox: [{ id: 'outbox-1', budget_archive_cancel_job_id: 'intent-1' }],
    }), 'org-1', 'project-1');
    assertEquals(result, true);
  });

  it('fails closed on an unknown intent state or an unreadable absence query', async () => {
    assertEquals(await hasUnsettledBudgetArchiveCancellation(client({
      budget_archive_cancel_intents: [{ id: 'intent-1', state: 'future-state' }],
    }), 'org-1', 'project-1'), true);
    await assertRejects(() => hasUnsettledBudgetArchiveCancellation(client({
      budget_archive_cancel_intents: [{ id: 'intent-1', state: 'superseded' }],
      external_command_outbox: [],
    }, 'external_command_outbox'), 'org-1', 'project-1'));
  });
});
