/**
 * AC-SEC-233 — the assistant's read tool does not offer bill and payment records to a role that reads none
 * (owner ruling 2026-10-23, migration 0350). An Engineer asking about supplier invoices or payments gets a clear
 * "not available for your role" result instead of an empty list that reads as "there are none". Every other
 * entity, and the four roles that read money records, are unchanged. Exercises the shipped action.
 */
import { describe, expect, it, vi } from 'vitest';
import { queryEntityAction } from '../../../../supabase/functions/agent-chat/actions';
import type { DeputyContext } from './runtime/port';

function ctxFor(role: string | null | undefined, rows: unknown[] = [{ id: 'r1' }]) {
  const terminal = () => Promise.resolve({ data: rows, error: null });
  const builder: Record<string, unknown> = {};
  for (const method of ['eq', 'in', 'is', 'neq', 'lt', 'lte', 'gt', 'gte', 'order']) builder[method] = vi.fn(() => builder);
  builder.limit = vi.fn(terminal);
  builder.range = vi.fn(terminal);
  const from = vi.fn(() => ({ select: vi.fn(() => builder) }));
  const ctx = { jwt: 'j', userId: 'u', orgId: 'o', supabase: { from }, ...(role === undefined ? {} : { role }) } as unknown as DeputyContext;
  return { ctx, from };
}

describe('AC-SEC-233 query_entity — money records by role', () => {
  it.each(['procurement_invoices', 'payments'])('AC-SEC-233 an Engineer asking for %s is told it is not available for their role, with no read', async (entity) => {
    const { ctx, from } = ctxFor('Engineer');
    const result = await queryEntityAction.run({ entity }, ctx);
    expect(result).toEqual({ error: `${entity} is not available for your role`, code: 'NOT_AVAILABLE_FOR_ROLE' });
    expect(from).not.toHaveBeenCalled();
  });

  it('AC-SEC-233 an aggregate over payments is refused for an Engineer too', async () => {
    const { ctx, from } = ctxFor('Engineer');
    const result = await queryEntityAction.run({ entity: 'payments', group_by: 'status', sum: 'amount' }, ctx);
    expect(result).toMatchObject({ code: 'NOT_AVAILABLE_FOR_ROLE' });
    expect(from).not.toHaveBeenCalled();
  });

  it('AC-SEC-233 a caller whose role is unknown gets no money records (allow-list)', async () => {
    for (const role of [null, undefined, 'Auditor']) {
      const { ctx, from } = ctxFor(role);
      expect(await queryEntityAction.run({ entity: 'payments' }, ctx)).toMatchObject({ code: 'NOT_AVAILABLE_FOR_ROLE' });
      expect(from).not.toHaveBeenCalled();
    }
  });

  it.each(['Admin', 'Executive', 'Project Manager', 'Finance'])('AC-SEC-233 %s still reads supplier invoices and payments', async (role) => {
    for (const entity of ['procurement_invoices', 'payments']) {
      const { ctx, from } = ctxFor(role);
      expect(await queryEntityAction.run({ entity }, ctx)).toEqual({ rowCount: 1, rows: [{ id: 'r1' }] });
      expect(from).toHaveBeenCalledWith(entity);
    }
  });

  it('AC-SEC-233 an Engineer still reads their purchasing records (purchase orders, receipts)', async () => {
    for (const entity of ['purchase_orders', 'procurement_receipts', 'procurements']) {
      const { ctx, from } = ctxFor('Engineer');
      expect(await queryEntityAction.run({ entity }, ctx)).toEqual({ rowCount: 1, rows: [{ id: 'r1' }] });
      expect(from).toHaveBeenCalledWith(entity);
    }
  });
});
