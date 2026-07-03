/**
 * actions.notify.test.ts — the `notify` AgentAction (ADR-0044 §5, FR-AAN-026/027/028).
 *
 * AC-AAN-031: confirm:false — dispatches immediately (no approval round-trip), addressed to the
 *   calling identity's own owner_id (RLS default pin — never an explicit owner_id in the insert).
 * AC-AAN-026: a `notify` call carrying metadata.run_id (the long-run-completion producer) inserts a
 *   row whose metadata.run_id equals the run.
 */
import { describe, it, expect, vi } from 'vitest';
import { notifyAction } from '../../../../supabase/functions/agent-chat/actions';
import type { DeputyContext, SupabaseLikeWithWrites } from './runtime/port';

function makeCtx(insertResult: { data: unknown; error: unknown } = { data: { id: 'notif-1' }, error: null }) {
  const single = vi.fn().mockResolvedValue(insertResult);
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  const sb = { from: vi.fn().mockReturnValue({ insert }) } as unknown as SupabaseLikeWithWrites;
  const ctx: DeputyContext = {
    jwt: 'caller-jwt',
    userId: 'user-1',
    orgId: 'org-1',
    supabase: sb,
  };
  return { ctx, insert, select, single, from: sb.from as unknown as ReturnType<typeof vi.fn> };
}

describe('notifyAction', () => {
  it('is registered with confirm:false (AC-AAN-031)', () => {
    expect(notifyAction.confirm).toBe(false);
    expect(notifyAction.name).toBe('notify');
  });

  it('AC-AAN-031 notify confirm:false dispatches immediately, addressed to the caller\'s own identity', async () => {
    const { ctx, insert, from } = makeCtx();

    const result = await notifyAction.run({ title: 'Run complete', body: 'All done.', severity: 'info' }, ctx);

    expect(from).toHaveBeenCalledWith('notifications');
    expect(insert).toHaveBeenCalledTimes(1);
    const payload = insert.mock.calls[0][0] as Record<string, unknown>;
    // Never sends an explicit owner_id/org_id — RLS column defaults pin the caller's own uid (FR-AAN-027).
    expect(payload).not.toHaveProperty('owner_id');
    expect(payload).not.toHaveProperty('org_id');
    expect(payload.title).toBe('Run complete');
    expect(payload.body).toBe('All done.');
    expect(payload.severity).toBe('info');
    expect(result).toEqual({ ok: true });
  });

  it('AC-AAN-026 a notify call carrying metadata.run_id inserts a row whose metadata.run_id equals the run', async () => {
    const { ctx, insert } = makeCtx();

    await notifyAction.run(
      { title: 'Bulk import done', body: '3 rows failed', metadata: { run_id: 'run-42' } },
      ctx,
    );

    const payload = insert.mock.calls[0][0] as Record<string, unknown>;
    expect((payload.metadata as { run_id: string }).run_id).toBe('run-42');
  });

  it('defaults severity to "info" and body to null when omitted', async () => {
    const { ctx, insert } = makeCtx();

    await notifyAction.run({ title: 'Just a title' }, ctx);

    const payload = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.severity).toBe('info');
    expect(payload.body).toBeNull();
    expect(payload.metadata).toBeNull();
  });

  it('returns a structured error (never throws) when title is missing', async () => {
    const { ctx, insert } = makeCtx();

    const result = await notifyAction.run({ body: 'no title' }, ctx);

    expect(result).toMatchObject({ error: expect.stringContaining('title') });
    expect(insert).not.toHaveBeenCalled();
  });

  it('returns a structured error on a db error', async () => {
    const { ctx } = makeCtx({ data: null, error: { message: 'denied', code: '42501' } });

    const result = await notifyAction.run({ title: 'x' }, ctx);

    expect(result).toMatchObject({ error: expect.stringContaining('notify'), code: '42501' });
  });
});
