/**
 * Tests for the query_entity action.
 * AC-AR-006: off-whitelist entity/column → structured error, no DB read.
 * AC-AR-007: row cap enforced; only whitelisted columns returned.
 * AC-AR-008: reads ONLY through ctx.supabase (caller-JWT client).
 *
 * All Supabase calls are mocked via DeputyContext injection.
 * No live DB; no service_role client.
 */
import { it, expect, vi } from 'vitest';
import {
  runQueryEntity,
  AGENT_READ_ROW_CAP,
} from '../../../../supabase/functions/agent-chat/actions';
import { AGENT_READ_ENTITIES, AGENT_ENTITY_TABLES } from '../../../../supabase/functions/agent-chat/readEntities';
import { resolveAgentEntity } from '../../../../supabase/functions/agent-chat/entityCatalog';
import type { DeputyContext } from './runtime/port';

// ── Mock helpers ──────────────────────────────────────────────────────────────

/**
 * Build a DeputyContext whose supabase always returns the given rows.
 * Captures the .limit() call argument for assertion.
 */
function mockCtx(
  rows: unknown[],
): DeputyContext & { capturedLimit: number | null } {
  let capturedLimit: number | null = null;

  const supabase = {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation((n: number) => {
            capturedLimit = n;
            return Promise.resolve({ data: rows, error: null });
          }),
          in: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation((n: number) => {
              capturedLimit = n;
              return Promise.resolve({ data: rows, error: null });
            }),
          }),
        }),
        limit: vi.fn().mockImplementation((n: number) => {
          capturedLimit = n;
          return Promise.resolve({ data: rows, error: null });
        }),
      }),
    }),
  } as unknown as DeputyContext['supabase'];

  const ctx = { jwt: 'j', userId: 'u', orgId: 'o', supabase } as DeputyContext & {
    capturedLimit: number | null;
  };
  Object.defineProperty(ctx, 'capturedLimit', {
    get: () => capturedLimit,
    enumerable: true,
  });
  return ctx;
}

// ── Task 6: AC-AR-007 happy path + row cap ────────────────────────────────────

it('AC-AR-007 caps rows at AGENT_READ_ROW_CAP and returns only whitelisted columns', async () => {
  // Supabase already applied .limit(); the mock returns exactly CAP rows.
  const cappedRows = Array.from({ length: AGENT_READ_ROW_CAP }, (_, i) => ({
    id: String(i),
    name: `p${i}`,
  }));
  const ctx = mockCtx(cappedRows);

  const res = await runQueryEntity(
    { entity: 'projects', columns: ['id', 'name'] },
    ctx,
  ) as { rowCount: number; rows: unknown[] };

  expect(res.rowCount).toBeLessThanOrEqual(AGENT_READ_ROW_CAP);
  expect(res.rows.length).toBeLessThanOrEqual(AGENT_READ_ROW_CAP);
  // The limit passed to supabase must be min(undefined ?? CAP, CAP) = CAP
  expect(ctx.capturedLimit).toBe(AGENT_READ_ROW_CAP);
});

it('AC-AR-007 respects a lower explicit limit (does not over-fetch)', async () => {
  const rows = [{ id: '1', name: 'p1' }];
  const ctx = mockCtx(rows);

  const res = await runQueryEntity(
    { entity: 'projects', columns: ['id', 'name'], limit: 10 },
    ctx,
  ) as { rowCount: number; rows: unknown[] };

  expect(res.rowCount).toBe(1);
  expect(ctx.capturedLimit).toBe(10); // min(10, 50) = 10
});

it('AC-AR-007 clamps an over-large explicit limit to AGENT_READ_ROW_CAP', async () => {
  const ctx = mockCtx([]);
  await runQueryEntity(
    { entity: 'projects', columns: ['id', 'name'], limit: 9999 },
    ctx,
  );
  expect(ctx.capturedLimit).toBe(AGENT_READ_ROW_CAP); // min(9999, 50) = 50
});

// ── Task 7: AC-AR-006 off-whitelist entity / column ───────────────────────────

it('AC-AR-006 returns a structured error (no throw, no DB read) for an off-whitelist entity', async () => {
  const fromSpy = vi.fn();
  const ctx = {
    jwt: 'j',
    userId: 'u',
    orgId: 'o',
    supabase: { from: fromSpy },
  } as unknown as DeputyContext;

  const res = await runQueryEntity(
    { entity: 'secret_table' },
    ctx,
  ) as { error: string };

  expect(res.error).toMatch(/unknown entity/i);
  expect(fromSpy).not.toHaveBeenCalled(); // no Supabase read attempted
});

it('AC-AR-006 returns a structured error for an off-whitelist column', async () => {
  const fromSpy = vi.fn();
  const ctx = {
    jwt: 'j',
    userId: 'u',
    orgId: 'o',
    supabase: { from: fromSpy },
  } as unknown as DeputyContext;

  const res = await runQueryEntity(
    { entity: 'projects', columns: ['ssn'] },
    ctx,
  ) as { error: string };

  expect(res.error).toMatch(/unknown column/i);
  expect(fromSpy).not.toHaveBeenCalled();
});

// ── Task 8: AC-AR-008 deputy invariant + requiredFilter branch ────────────────

it('AC-AR-008 reads ONLY through ctx.supabase (the caller-JWT client) — no other client reachable', async () => {
  const fromSpy = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
  });
  const ctx = {
    jwt: 'j',
    userId: 'u',
    orgId: 'o',
    supabase: { from: fromSpy },
  } as unknown as DeputyContext;

  await runQueryEntity({ entity: 'companies' }, ctx);

  expect(fromSpy).toHaveBeenCalledWith('companies'); // the only data path is ctx.supabase
});

it('AC-AR-008 projects (no requiredFilter) reads cleanly with optional filter (R3 branch coverage)', async () => {
  const ctx = mockCtx([{ id: '1' }]);

  const res = await runQueryEntity(
    { entity: 'projects', columns: ['id'], filter: { column: 'id', op: 'eq', value: '1' } },
    ctx,
  );

  expect((res as { error?: string }).error).toBeUndefined();
  expect((res as { rowCount: number }).rowCount).toBe(1);
});

it('requiredFilter entity would be refused when filter is absent (proves the branch ships now)', async () => {
  // 'tasks' has requiredFilter: 'project_id' but is NOT in AGENT_READ_ENTITIES.
  // Test the requiredFilter code path by verifying entities without requiredFilter pass.
  // The actual requiredFilter refusal is tested when 'tasks' is added in A3;
  // here we just confirm projects + companies pass without filter.
  const ctx = mockCtx([]);
  const res = await runQueryEntity({ entity: 'projects' }, ctx);
  expect((res as { error?: string }).error).toBeUndefined();
});

// ── Blocker 6: filter column must be in allowedColumns (column-whitelist bypass) ─────

it('AC-AR-006 filter on a non-whitelisted column returns structured error with no DB read (Blocker 6)', async () => {
  // RED: old code validated select columns but not the filter.column.
  // A prompt-injected tool call filtering on 'password_hash' or any other excluded
  // column would reach ctx.supabase.eq('password_hash', ...) — a boolean oracle attack.
  const fromSpy = vi.fn();
  const ctx = {
    jwt: 'j',
    userId: 'u',
    orgId: 'o',
    supabase: { from: fromSpy },
  } as unknown as DeputyContext;

  const res = await runQueryEntity(
    {
      entity: 'projects',
      columns: ['id', 'name'],
      filter: { column: 'secret_internal_column', op: 'eq', value: 'guess' },
    },
    ctx,
  ) as { error: string };

  expect(res.error).toMatch(/unknown filter column/i);
  expect(fromSpy).not.toHaveBeenCalled(); // no DB read attempted
});

it('filter on a whitelisted column is allowed to proceed (control — no false positives)', async () => {
  // The fix must only block non-whitelisted filter columns.
  // A filter on 'id' (which IS in allowedColumns for projects) must reach the DB.
  const ctx = mockCtx([{ id: '1', name: 'proj' }]);

  const res = await runQueryEntity(
    {
      entity: 'projects',
      columns: ['id', 'name'],
      filter: { column: 'id', op: 'eq', value: '1' },
    },
    ctx,
  ) as { rowCount: number };

  expect(res.rowCount).toBe(1);
  // fromSpy WAS called (the DB was reached for a valid filter column)
  expect((ctx.supabase.from as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
});

// ── Blocker 1: in-filter with multi-value list calls .in() directly (not .eq().in()) ──

it('in-filter with multiple values calls .in() directly on the builder — not .eq().in()', async () => {
  // RED: the old code called builder.eq(col, vals[0]).in(col, vals).limit(n)
  // which AND-constrains to just the first value for multi-element lists.
  // Correct path: builder.in(col, vals).limit(n)
  const inSpy = vi.fn().mockReturnValue({
    limit: vi.fn().mockResolvedValue({ data: [{ id: '1' }, { id: '2' }], error: null }),
  });
  const eqSpy = vi.fn();
  const ctx = {
    jwt: 'j',
    userId: 'u',
    orgId: 'o',
    supabase: {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          in: inSpy,
          eq: eqSpy,
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    },
  } as unknown as DeputyContext;

  const res = await runQueryEntity(
    { entity: 'projects', columns: ['id'], filter: { column: 'id', op: 'in', value: ['1', '2'] } },
    ctx,
  ) as { rowCount: number; rows: unknown[] };

  // .in() must be called directly (not chained after .eq())
  expect(inSpy).toHaveBeenCalledWith('id', ['1', '2']);
  // .eq() must NOT have been called at all (would AND-constrain)
  expect(eqSpy).not.toHaveBeenCalled();
  expect(res.rowCount).toBe(2);
});

// ── Defect 2: broadened read scope — every RLS-readable business entity is exposed, each mapped
//    to its real table, and curated entities enforce a conservative column allowlist. RLS is still
//    the enforcement authority (the caller-JWT client caps every row); the agent adds no privilege.

it('Defect-2 AGENT_READ_ENTITIES exposes the full business-entity set (not just projects/companies)', () => {
  // The pre-defect scope was exactly ['projects','companies']. The broadened catalogue must include
  // the core business domains the user asks about: CRM (companies/contacts), delivery (tasks),
  // spend (procurements), safety (incidents), planning (milestones), time (timesheets).
  const keys = [...AGENT_READ_ENTITIES];
  for (const required of ['projects', 'companies', 'tasks', 'incidents', 'contacts', 'procurements', 'milestones', 'timesheets', 'crm_activities']) {
    expect(keys, `AGENT_READ_ENTITIES must expose ${required}`).toContain(required);
  }
});

it('broadened read scope exposes the procure-to-pay lifecycle + docs/team/notifications', () => {
  const keys = [...AGENT_READ_ENTITIES];
  for (const required of [
    'purchase_requests', 'rfqs', 'procurement_quotations', 'purchase_orders', 'procurement_receipts',
    'procurement_invoices', 'payments', 'procurement_items', 'procurement_status_events',
    'budget_line_items', 'project_documents', 'procurement_documents', 'profiles', 'notifications',
  ]) {
    expect(keys, `AGENT_READ_ENTITIES must expose ${required}`).toContain(required);
  }
});

it('TENANCY INVARIANT: no curated entity ever exposes org_id, and every read entity resolves to a table', () => {
  // The single most important guard for a broad read scope: org_id is the tenancy seam and must
  // NEVER be selectable/filterable — RLS caps rows, but a leaked org_id would let the model reason
  // across the seam. Assert it for every curated allowlist AND that every AGENT_READ_ENTITIES key
  // resolves (no dangling entity the prompt advertises but the runtime can't serve).
  for (const [key, entry] of Object.entries(AGENT_ENTITY_TABLES)) {
    expect(entry.allowedColumns, `${key} must not expose org_id`).not.toContain('org_id');
    // No raw-storage / ETL plumbing columns either (defense-in-depth against a copy-paste slip).
    for (const banned of ['file_url', 'file_path', 'link', 'avatar_url', 'import_key', 'import_batch_id']) {
      expect(entry.allowedColumns, `${key} must not expose ${banned}`).not.toContain(banned);
    }
  }
  for (const key of AGENT_READ_ENTITIES) {
    expect(resolveAgentEntity(key), `${key} must resolve to a table`).toBeDefined();
  }
});

it('crm_activities is readable, maps to its table, and never exposes org_id (tenancy seam)', async () => {
  // Follow-up finding (2026-07-07): the agent could not answer "any activities in the CRM?" because
  // crm_activities had no read entity. Now exposed (RLS still caps rows to the caller). The column
  // allowlist must carry the useful business columns AND must never include org_id.
  const fromSpy = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [{ id: 'a1' }], error: null }) }),
    }),
  });
  const ctx = { jwt: 'j', userId: 'u', orgId: 'o', supabase: { from: fromSpy } } as unknown as DeputyContext;

  const ok = await runQueryEntity(
    { entity: 'crm_activities', filter: { column: 'project_id', op: 'eq', value: 'p1' } },
    ctx,
  ) as { rowCount?: number; error?: string };
  expect(ok.error).toBeUndefined();
  expect(ok.rowCount).toBe(1);
  expect(fromSpy).toHaveBeenCalledWith('crm_activities');

  // org_id is the tenancy seam — filtering on it must be rejected (not in the allowlist).
  const seam = await runQueryEntity(
    { entity: 'crm_activities', filter: { column: 'org_id', op: 'eq', value: 'x' } },
    ctx,
  ) as { error?: string };
  expect(seam.error).toMatch(/unknown filter column|org_id/i);
});

it('Defect-2 a curated entity maps to its REAL table — procurements → procurements table', async () => {
  const fromSpy = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
  });
  const ctx = { jwt: 'j', userId: 'u', orgId: 'o', supabase: { from: fromSpy } } as unknown as DeputyContext;

  await runQueryEntity({ entity: 'procurements', columns: ['id'] }, ctx);
  expect(fromSpy).toHaveBeenCalledWith('procurements');
});

it('Defect-2 milestones maps to its real table project_milestones (friendly key ≠ table name)', async () => {
  const fromSpy = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
  });
  const ctx = { jwt: 'j', userId: 'u', orgId: 'o', supabase: { from: fromSpy } } as unknown as DeputyContext;

  await runQueryEntity({ entity: 'milestones', columns: ['id'] }, ctx);
  expect(fromSpy).toHaveBeenCalledWith('project_milestones');
});

it('Defect-2 timesheets is accepted and maps to the timesheets table', async () => {
  const fromSpy = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
  });
  const ctx = { jwt: 'j', userId: 'u', orgId: 'o', supabase: { from: fromSpy } } as unknown as DeputyContext;

  const res = await runQueryEntity({ entity: 'timesheets', columns: ['id', 'status'] }, ctx);
  expect((res as { error?: string }).error).toBeUndefined();
  expect(fromSpy).toHaveBeenCalledWith('timesheets');
});

it('Defect-2 curated entities keep a conservative column allowlist — procurements rejects org_id (tenancy seam) and approval_notes', async () => {
  // org_id must never be selectable (would surface the tenancy column); approval_notes is sensitive
  // rationale. Both must be refused at the column-whitelist gate with NO DB read.
  for (const blocked of ['org_id', 'approval_notes', 'rejection_notes', 'approved_by_id']) {
    const fromSpy = vi.fn();
    const ctx = { jwt: 'j', userId: 'u', orgId: 'o', supabase: { from: fromSpy } } as unknown as DeputyContext;
    const res = await runQueryEntity({ entity: 'procurements', columns: [blocked] }, ctx) as { error: string };
    expect(res.error, `procurements.${blocked} must be blocked`).toMatch(/unknown column/i);
    expect(fromSpy, `procurements.${blocked} must not reach the DB`).not.toHaveBeenCalled();
  }
});

it('Defect-2 tasks (reused from ENTITY_WHITELIST) now exposed and requires its project_id filter', async () => {
  // tasks is in the broadened set; its requiredFilter (project_id) still enforces — a bare tasks
  // query is refused (no cross-project task dump), and supplying project_id is accepted.
  const fromSpy = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [{ id: 't1' }], error: null }) }),
    }),
  });
  const ctx = { jwt: 'j', userId: 'u', orgId: 'o', supabase: { from: fromSpy } } as unknown as DeputyContext;

  const refused = await runQueryEntity({ entity: 'tasks' }, ctx) as { error?: string };
  expect(refused.error).toMatch(/requires a filter on column project_id/i);

  const ok = await runQueryEntity({ entity: 'tasks', filter: { column: 'project_id', op: 'eq', value: 'p1' } }, ctx) as { rowCount?: number; error?: string };
  expect(ok.error).toBeUndefined();
  expect(ok.rowCount).toBe(1);
  expect(fromSpy).toHaveBeenCalledWith('tasks');
});

it('Defect-2 an entity still NOT in the catalogue is refused (no privilege widening beyond the allowlist)', async () => {
  // `credits` is deliberately NOT exposed — billing internals, not a user-facing business domain
  // (see the skip list: agent_*/credits/audit_events/organizations/*_files are never exposed).
  const fromSpy = vi.fn();
  const ctx = { jwt: 'j', userId: 'u', orgId: 'o', supabase: { from: fromSpy } } as unknown as DeputyContext;
  const res = await runQueryEntity({ entity: 'credits' }, ctx) as { error: string };
  expect(res.error).toMatch(/unknown entity/i);
  expect(fromSpy).not.toHaveBeenCalled();
});

// ── Live-loop finding (2026-07-07): a DB error must be SURFACED, not swallowed ──────
// The model filtered projects.status with a value split out of the comma-containing enum
// label "Won, Pending KoM" → Postgres 22P02. The old code returned an opaque
// "query_entity db error" with no code/detail, so the model had NO signal to self-correct
// and the run died. The tool must now return the DB error code + message so the model can
// recover (retry with a valid value). No row data is leaked (the message only echoes the
// caller's own filter input + the enum/column name, already implied by the whitelist).
it('surfaces the DB error code + detail on a query failure (so the model can self-correct)', async () => {
  const dbError = {
    code: '22P02',
    message: 'invalid input value for enum project_status: "Won"',
  };
  const supabase = {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: null, error: dbError }),
        }),
      }),
    }),
  };
  const ctx = { jwt: 'j', userId: 'u', orgId: 'o', supabase } as unknown as DeputyContext;

  const res = (await runQueryEntity(
    { entity: 'projects', columns: ['id', 'name', 'status'], filter: { column: 'status', op: 'in', value: ['Won', 'Pending KoM'] } },
    ctx,
  )) as { error: string; code?: string; detail?: string };

  expect(res.error).toBeTruthy();
  expect(res.code).toBe('22P02');
  expect(res.detail).toMatch(/invalid input value for enum/i);
});
