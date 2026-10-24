import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc } }));

import {
  endCostAttributionRule,
  listCostAttributionRules,
  previewCostAttribution,
  saveCostAttributionRule,
} from './costAttribution';

beforeEach(() => rpc.mockReset());

describe('costAttribution repository (#1271, AC-7)', () => {
  it('lists current rules with targets read as numbers, never strings', async () => {
    rpc.mockResolvedValue({
      data: [{
        id: 'v2', rule_key: 'k', version: 2, is_current: true, name: 'Payroll', match_account: 'Salary - RIS',
        match_account_group: null, match_cost_center: null, match_party_type: null, match_party: null,
        effective_from: '2025-01-01', effective_to: null, specificity: 2, created_by: 'u', created_at: '2025-01-01T00:00:00Z',
        targets: [{ project_id: 'p1', project_name: 'Alpha', percent: '60.5000' }, { project_id: 'p2', project_name: 'Beta', percent: 39.5 }],
      }],
      error: null,
    });
    const rows = await listCostAttributionRules();
    expect(rpc).toHaveBeenCalledWith('list_cost_attribution_rules', { p_include_history: false });
    expect(rows[0].targets.map((t) => t.percent)).toEqual([60.5, 39.5]);
  });

  it('keeps the Postgres code on a refusal so the form can classify it (40001 stale, 23505 tie)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '40001', message: 'rule changed since it was loaded (current version 3)' } });
    await expect(saveCostAttributionRule({ name: 'x' } as never)).rejects.toMatchObject({ code: '40001' });
  });

  it('previews through the same draft JSON the save takes and returns numeric amounts', async () => {
    rpc.mockResolvedValue({ data: [{ project_id: 'p1', month: '2025-02-01', category: null, amount: '1200.50', line_count: 3 }], error: null });
    const rows = await previewCostAttribution({ name: 'x' } as never);
    expect(rpc).toHaveBeenCalledWith('preview_cost_attribution', { p_rule: { name: 'x' } });
    expect(rows).toEqual([{ project_id: 'p1', month: '2025-02-01', category: null, amount: 1200.5, line_count: 3 }]);
  });

  it('ends a rule with its expected version', async () => {
    rpc.mockResolvedValue({ data: { rule_key: 'k', version: 3, id: 'v3', changed: true }, error: null });
    await endCostAttributionRule('k', '2025-06-30', 2);
    expect(rpc).toHaveBeenCalledWith('end_cost_attribution_rule', {
      p_rule_key: 'k', p_effective_to: '2025-06-30', p_expected_version: 2,
    });
  });
});
