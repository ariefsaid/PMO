import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * #1514 T7.1 (data half) — the time-and-materials DAL.
 *
 * Every write is an RPC (0515-0517): no `org_id`, author, stamp or status ever leaves the client, and the RPCs keep
 * their refusal codes (42501/22023/23514/23505/40001/P0001/P0002) untouched. Both reads are RPCs too (0518); the rate
 * card and the claim-source drill-down are table reads, bounded at `LIST_LIMIT + 1` so a silently trimmed read can never
 * be mistaken for the whole set (money-path bucket 5). An unrated preview row keeps `amount` NULL — never zero.
 */
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = {
    from: [] as string[], rpc: [] as Array<[string, unknown]>, eq: [] as unknown[], is: [] as unknown[],
    order: [] as unknown[], limit: [] as unknown[], select: [] as unknown[], single: 0,
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...a: unknown[]) => { (calls[name] as unknown[]).push(a.length === 1 ? a[0] : a); return builder; };
  for (const k of ['select', 'eq', 'is', 'order', 'limit'] as const) builder[k] = chain(k);
  builder.single = () => { calls.single++; return builder; };
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((t: string) => { calls.from.push(t); return builder; });
  const rpc = vi.fn((n: string, a?: unknown) => { calls.rpc.push([n, a]); return Promise.resolve(result.value); });
  return { from, rpc, calls, result };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import * as dal from './timeAndMaterials';
const { LIST_LIMIT } = dal;

beforeEach(() => {
  h.from.mockClear();
  h.rpc.mockClear();
  for (const [k, v] of Object.entries(h.calls)) {
    if (typeof v === 'number') (h.calls as unknown as Record<string, number>)[k] = 0;
    else (v as unknown[]).length = 0;
  }
  h.result.value = { data: null, error: null };
});

describe('#1514 T7.1 contract-rate writes', () => {
  it('T7.1 saveContractRateLine sends the line only — no org_id, no author, no stamp', async () => {
    h.result.value = { data: { id: 'l1', line_key: 'k1', version: 2, changed: true }, error: null };
    const input = {
      project_id: 'p1', line_key: 'k1', label: 'Site engineer', unit: 'hour' as const, rate: 50000,
      effective_from: '2026-09-01', effective_to: null, expected_version: 1,
    };
    await expect(dal.saveContractRateLine(input)).resolves.toEqual({ id: 'l1', lineKey: 'k1', version: 2, changed: true });
    expect(h.calls.rpc).toEqual([['save_contract_rate_line', { p_line: input }]]);
    for (const forbidden of ['org_id', 'created_by', 'created_at', 'version', 'is_current']) {
      expect(Object.keys(input)).not.toContain(forbidden);
    }
  });

  it('T7.1 endContractRateLine names the line and its expected version', async () => {
    h.result.value = { data: { id: 'l2', line_key: 'k1', version: 3, changed: true }, error: null };
    await expect(dal.endContractRateLine({
      projectId: 'p1', lineKey: 'k1', effectiveTo: '2026-12-31', expectedVersion: 2,
    })).resolves.toEqual({ id: 'l2', lineKey: 'k1', version: 3, changed: true });
    expect(h.calls.rpc).toEqual([['end_contract_rate_line', {
      p_project: 'p1', p_line_key: 'k1', p_effective_to: '2026-12-31', p_expected_version: 2,
    }]]);
  });

  it('T7.1 a stale expected_version keeps 40001 so the screen can reload the line', async () => {
    h.result.value = { data: null, error: { message: 'rate line changed since it was loaded (current version 3)', code: '40001' } };
    await expect(dal.saveContractRateLine({
      project_id: 'p1', label: 'Site engineer', unit: 'hour', rate: 50000, effective_from: '2026-09-01', expected_version: 1,
    })).rejects.toMatchObject({ code: '40001', name: 'AppError' });
  });

  it('T7.1 the assignment pair sends a date window and never an org', async () => {
    h.result.value = { data: 'a1', error: null };
    await expect(dal.setContractRateAssignee({
      projectId: 'p1', lineKey: 'k1', userId: 'u1', from: '2026-09-01', to: '2026-12-31',
    })).resolves.toBe('a1');
    expect(h.calls.rpc).toEqual([['set_contract_rate_assignee', {
      p_project: 'p1', p_line_key: 'k1', p_user: 'u1', p_from: '2026-09-01', p_to: '2026-12-31',
    }]]);
    h.result.value = { data: null, error: null };
    await dal.endContractRateAssignee({ projectId: 'p1', assigneeId: 'a1', effectiveTo: '2026-12-31' });
    expect(h.calls.rpc[1]).toEqual(['end_contract_rate_assignee', {
      p_project: 'p1', p_assignee: 'a1', p_effective_to: '2026-12-31',
    }]);
  });

  it('T7.1 a refused write surfaces the server message and code unchanged', async () => {
    h.result.value = { data: null, error: { message: 'not authorized to save contract rates', code: '42501' } };
    await expect(dal.saveContractRateLine({
      project_id: 'p1', label: 'Site engineer', unit: 'hour', rate: 50000, effective_from: '2026-09-01',
    })).rejects.toMatchObject({ message: 'not authorized to save contract rates', code: '42501' });
  });
});

describe('#1514 T7.1 contract-rate reads', () => {
  it('T7.1 listRateLines reads the current lines of one project, bounded at LIST_LIMIT + 1', async () => {
    h.result.value = { data: [{ id: 'l1' }], error: null };
    await expect(dal.listRateLines('p1')).resolves.toEqual({ rows: [{ id: 'l1' }], truncated: false });
    expect(h.calls.from).toEqual(['contract_rate_lines']);
    expect(h.calls.eq).toContainEqual(['project_id', 'p1']);
    expect(h.calls.eq).toContainEqual(['is_current', true]);
    expect(h.calls.limit).toContain(LIST_LIMIT + 1);
  });

  it('T7.1 a saturated rate read is flagged, not silently trimmed', async () => {
    h.result.value = { data: Array.from({ length: LIST_LIMIT + 1 }, (_, i) => ({ id: `l${i}` })), error: null };
    const page = await dal.listRateLines('p1', { includeHistory: true });
    expect(page.rows).toHaveLength(LIST_LIMIT);
    expect(page.truncated).toBe(true);
    expect(h.calls.eq.map((c) => (c as unknown[])[0])).not.toContain('is_current');
  });

  it('T7.1 listRateAssignees reads one project, bounded', async () => {
    h.result.value = { data: [], error: null };
    await expect(dal.listRateAssignees('p1')).resolves.toEqual({ rows: [], truncated: false });
    expect(h.calls.from).toEqual(['contract_rate_assignees']);
    expect(h.calls.eq).toContainEqual(['project_id', 'p1']);
    expect(h.calls.limit).toContain(LIST_LIMIT + 1);
  });
});

describe('#1514 T7.1 claim assembly and sign-off', () => {
  it('T7.1 assembleTmClaim sends the period, the optional work order and the excluded sources', async () => {
    h.result.value = { data: 'c1', error: null };
    await expect(dal.assembleTmClaim({
      projectId: 'p1', from: '2026-09-01', to: '2026-09-30', workOrderId: 'w1', exclude: ['s1', 's2'],
    })).resolves.toBe('c1');
    expect(h.calls.rpc).toEqual([['assemble_tm_claim', {
      p_project: 'p1', p_from: '2026-09-01', p_to: '2026-09-30', p_work_order: 'w1', p_exclude: ['s1', 's2'],
    }]]);
  });

  it('T7.1 an assembly without a work order omits the key rather than sending null', async () => {
    h.result.value = { data: 'c1', error: null };
    await dal.assembleTmClaim({ projectId: 'p1', from: '2026-09-01', to: '2026-09-30' });
    expect(h.calls.rpc[0][1]).toEqual({ p_project: 'p1', p_from: '2026-09-01', p_to: '2026-09-30' });
  });

  it('T7.1 an hour already in a live claim keeps its refusal code so the claim id can be shown', async () => {
    h.result.value = { data: null, error: { message: 'an hour is already in claim c9', code: 'P0001' } };
    await expect(dal.assembleTmClaim({ projectId: 'p1', from: '2026-09-01', to: '2026-09-30' }))
      .rejects.toMatchObject({ code: 'P0001', message: 'an hour is already in claim c9' });
  });

  it('T7.1 deselect, prepare and withdraw call their RPCs with the claim id', async () => {
    h.result.value = { data: null, error: null };
    await dal.deselectTmSource('c1', 's1');
    await dal.prepareTmSignoff({ claimId: 'c1', documentId: 'd1', note: null });
    await dal.withdrawTmSignoff('c1');
    expect(h.calls.rpc).toEqual([
      ['deselect_tm_source', { p_claim: 'c1', p_source: 's1' }],
      ['prepare_tm_signoff', { p_claim: 'c1', p_document: 'd1' }],
      ['withdraw_tm_signoff', { p_claim: 'c1' }],
    ]);
  });

  it('T7.1 a prepared note is sent when present', async () => {
    h.result.value = { data: null, error: null };
    await dal.prepareTmSignoff({ claimId: 'c1', documentId: 'd1', note: ' signed at site ' });
    expect(h.calls.rpc[0][1]).toEqual({ p_claim: 'c1', p_document: 'd1', p_note: 'signed at site' });
  });

  it('T7.1 confirmTmSignoff returns the authoritative basis and gross, never a guessed zero', async () => {
    h.result.value = { data: { claim_id: 'c1', basis: 'sole_operator', gross_amount: 6000000 }, error: null };
    await expect(dal.confirmTmSignoff('c1')).resolves.toEqual({
      claimId: 'c1', basis: 'sole_operator', grossAmount: 6000000,
    });
    expect(h.calls.rpc).toEqual([['confirm_tm_signoff', { p_claim: 'c1' }]]);
  });

  it('T7.1 a malformed confirm response is an error, not a silent zero', async () => {
    h.result.value = { data: { claim_id: 'c1', basis: 'standard' }, error: null };
    await expect(dal.confirmTmSignoff('c1')).rejects.toMatchObject({ name: 'AppError' });
    h.result.value = { data: null, error: null };
    await expect(dal.confirmTmSignoff('c1')).rejects.toMatchObject({ name: 'AppError' });
  });

  it('T7.1 a refused confirm keeps 42501 so the separation-of-duties refusal reaches the user', async () => {
    h.result.value = { data: null, error: { message: 'separation of duties: the preparer cannot confirm this sign-off', code: '42501' } };
    await expect(dal.confirmTmSignoff('c1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('#1514 T7.1 claim and preview reads', () => {
  it('T7.1 listTmClaims queries one project and parses the frozen line JSON', async () => {
    h.result.value = {
      data: [{
        id: 'c1', work_order_id: null, period_from: '2026-09-01', period_to: '2026-09-30', status: 'SignedOff',
        currency: 'IDR', gross_amount: 6000000, prepared_by: 'u1', signoff_prepared_by: 'u2', confirmed_by: 'u3',
        confirm_basis: 'standard', document_id: 'd1', note: null, created_at: '2026-10-01T00:00:00Z',
        lines: [{ line_key: 'k1', rate_version: 1, kind: 'labour', label: 'Site engineer', unit: 'hour', units: 120, rate: 50000, amount: 6000000 }],
      }],
      error: null,
    };
    const page = await dal.listTmClaims('p1');
    expect(h.calls.rpc).toEqual([['list_tm_claims', { p_project: 'p1' }]]);
    expect(page.truncated).toBe(false);
    expect(page.rows[0].gross_amount).toBe(6000000);
    expect(page.rows[0].lines).toEqual([{ lineKey: 'k1', rateVersion: 1, kind: 'labour', label: 'Site engineer', unit: 'hour', units: 120, rate: 50000, amount: 6000000 }]);
  });

  it('T7.1 a claim list with unreadable line JSON fails loudly rather than showing a claim with no lines', async () => {
    h.result.value = {
      data: [{ id: 'c1', period_from: '2026-09-01', period_to: '2026-09-30', status: 'Draft', currency: 'IDR', gross_amount: 0, lines: 'not-a-list' }],
      error: null,
    };
    await expect(dal.listTmClaims('p1')).rejects.toMatchObject({ name: 'AppError' });
  });

  it('T7.1 previewTmClaim sends the range and keeps an unrated group amount NULL', async () => {
    h.result.value = {
      data: [
        { line_key: 'k1', rate_version: 1, kind: 'labour', label: 'Site engineer', unit: 'hour', rate: 50000, user_id: null, units: 120, amount: 6000000, source_count: 5, unrated_reason: null },
        { line_key: null, rate_version: null, kind: 'labour', label: 'Unrated', unit: 'hour', rate: null, user_id: 'u4', units: 6, amount: null, source_count: 1, unrated_reason: 'no rate assigned' },
      ],
      error: null,
    };
    const page = await dal.previewTmClaim({ projectId: 'p1', from: '2026-09-01', to: '2026-09-30' });
    expect(h.calls.rpc).toEqual([['preview_tm_claim', { p_project: 'p1', p_from: '2026-09-01', p_to: '2026-09-30' }]]);
    expect(page.rows[1].amount).toBeNull();
    expect(page.rows[1].unrated_reason).toBe('no rate assigned');
  });

  it('T7.1 listTmClaimSources reads the drill-down of one claim, bounded', async () => {
    h.result.value = { data: [], error: null };
    await expect(dal.listTmClaimSources('c1')).resolves.toEqual({ rows: [], truncated: false });
    expect(h.calls.from).toEqual(['tm_claim_sources']);
    expect(h.calls.eq).toContainEqual(['claim_id', 'c1']);
    expect(h.calls.limit).toContain(LIST_LIMIT + 1);
  });

  it('T7.1 an Engineer refused by the amounts gate keeps 42501', async () => {
    h.result.value = { data: null, error: { message: 'not authorized to read time-and-materials claims for this project', code: '42501' } };
    await expect(dal.previewTmClaim({ projectId: 'p1', from: '2026-09-01', to: '2026-09-30' }))
      .rejects.toMatchObject({ code: '42501' });
  });
});
