import { describe, it, expect, vi, beforeEach } from 'vitest';
const rpc = vi.fn();
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
import { getImprestRequesterRoute, parseImprestRequesterRoute } from '../imprest';

beforeEach(() => { rpc.mockReset(); });

describe('#1568 getImprestRequesterRoute', () => {
  it('sends only the kind and the record id, then returns the parsed route', async () => {
    rpc.mockResolvedValue({
      data: { route_kind: 'named', approvers: [{ id: 'u1', name: 'Sari', role: 'Executive' }], action: 'approve', admin_breakglass: true },
      error: null,
    });
    await expect(getImprestRequesterRoute('limit_change', 'ch1')).resolves.toEqual({
      route_kind: 'named', approvers: [{ id: 'u1', name: 'Sari', role: 'Executive' }], action: 'approve', admin_breakglass: true,
    });
    expect(rpc.mock.calls).toEqual([['get_imprest_requester_route', { p_kind: 'limit_change', p_record_id: 'ch1' }]]);
  });

  it('surfaces an RPC refusal as an AppError that keeps its code', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'LIGHT_ACCOUNT: refused' } });
    await expect(getImprestRequesterRoute('plan', 'pl1')).rejects.toMatchObject({ code: '42501' });
  });

  it('reads an unrecognised payload as no answer instead of inventing a route', async () => {
    rpc.mockResolvedValue({ data: { route_kind: 'made_up', approvers: [] }, error: null });
    await expect(getImprestRequesterRoute('plan', 'pl1')).resolves.toBeNull();
    expect(parseImprestRequesterRoute(null)).toBeNull();
    expect(parseImprestRequesterRoute('named')).toBeNull();
  });

  it('keeps only well-formed approvers (no half-person leaks into a name)', () => {
    expect(parseImprestRequesterRoute({
      route_kind: 'named',
      approvers: [{ id: 'u1', name: 'Sari', role: 'Executive' }, { id: 'u2', name: 'No role' }, null],
      action: 'approve',
    })).toEqual({
      route_kind: 'named', approvers: [{ id: 'u1', name: 'Sari', role: 'Executive' }], action: 'approve', admin_breakglass: false,
    });
  });

  it('treats an unknown action as none and a missing approver list as empty', () => {
    expect(parseImprestRequesterRoute({ route_kind: 'admin', action: 'decide' })).toEqual({
      route_kind: 'admin', approvers: [], action: null, admin_breakglass: false,
    });
  });

  it('refuses an internally inconsistent shape rather than rendering a false slot', () => {
    // A named route with nobody, or a payment step with no payer, is not an answer the screen may show.
    expect(parseImprestRequesterRoute({ route_kind: 'named', approvers: [], action: 'approve' })).toBeNull();
    expect(parseImprestRequesterRoute({ route_kind: 'finance_admin', approvers: [], action: 'pay' })).toBeNull();
    // The role-only finance approval and the admin/flat routes carry no names by design.
    expect(parseImprestRequesterRoute({ route_kind: 'finance_admin', approvers: [], action: 'approve' })).toEqual({
      route_kind: 'finance_admin', approvers: [], action: 'approve', admin_breakglass: false,
    });
  });
});
