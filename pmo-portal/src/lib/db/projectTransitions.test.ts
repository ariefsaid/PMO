import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted mock setup — mirrors timesheetTransition.test.ts builder pattern
// ---------------------------------------------------------------------------

const { mockRpc, mockFrom, mockSelect } = vi.hoisted(() => {
  const mockRpc = vi.fn();
  const mockFrom = vi.fn();
  const mockSelect = vi.fn();
  return { mockRpc, mockFrom, mockSelect };
});

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
}));

import {
  isLegalProjectTransition,
  projectStatusGroup,
  transitionProject,
  listPipelineStageConfig,
} from './projectTransitions';

// ---------------------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------------------

function makeRpcBuilder(resolved: { data: unknown; error: unknown }) {
  const builder = {
    then: (resolve: (v: typeof resolved) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(resolved).then(resolve, reject),
  };
  mockRpc.mockReturnValue(builder);
  return builder;
}

function makeFromBuilder(resolved: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  builder.select = mockSelect.mockReturnValue(builder);
  builder.then = (resolve: (v: typeof resolved) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(resolved).then(resolve, reject);
  mockFrom.mockReturnValue(builder);
  return builder;
}

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
  mockSelect.mockReset();
});

// ---------------------------------------------------------------------------
// B1/B2 — Transition map (AC-1000)
// ---------------------------------------------------------------------------

describe('isLegalProjectTransition', () => {
  it('AC-1000: project transition map accepts legal pairs, rejects illegal jumps, terminals and no-ops (FR-PR-001/003)', () => {
    // Legal pairs
    expect(isLegalProjectTransition('Leads', 'PQ Submitted')).toBe(true);
    expect(isLegalProjectTransition('Negotiation', 'Won, Pending KoM')).toBe(true);
    expect(isLegalProjectTransition('Tender Submitted', 'Loss Tender')).toBe(true);
    expect(isLegalProjectTransition('Won, Pending KoM', 'Ongoing Project')).toBe(true);
    expect(isLegalProjectTransition('On Hold', 'Ongoing Project')).toBe(true);
    expect(isLegalProjectTransition('Close Out', 'Ongoing Project')).toBe(true);
    expect(isLegalProjectTransition('Loss Tender', 'Negotiation')).toBe(true);
    expect(isLegalProjectTransition('Leads', 'Internal Project')).toBe(true);

    // Illegal jumps
    expect(isLegalProjectTransition('Leads', 'Won, Pending KoM')).toBe(false);
    expect(isLegalProjectTransition('Internal Project', 'Leads')).toBe(false);
    expect(isLegalProjectTransition('Ongoing Project', 'Leads')).toBe(false);
    // No-op
    expect(isLegalProjectTransition('Leads', 'Leads')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B3 — Status-group helper (AC-1001)
// ---------------------------------------------------------------------------

describe('projectStatusGroup', () => {
  it('AC-1001: projectStatusGroup maps the five pipeline statuses to pipeline, the won/active set to onHand, Loss Tender to lost, Internal Project to internal (FR-PR-012)', () => {
    // Pipeline statuses
    expect(projectStatusGroup('Leads')).toBe('pipeline');
    expect(projectStatusGroup('PQ Submitted')).toBe('pipeline');
    expect(projectStatusGroup('Quotation Submitted')).toBe('pipeline');
    expect(projectStatusGroup('Tender Submitted')).toBe('pipeline');
    expect(projectStatusGroup('Negotiation')).toBe('pipeline');

    // onHand statuses
    expect(projectStatusGroup('Won, Pending KoM')).toBe('onHand');
    expect(projectStatusGroup('Ongoing Project')).toBe('onHand');
    expect(projectStatusGroup('On Hold')).toBe('onHand');
    expect(projectStatusGroup('Close Out')).toBe('onHand');

    // Lost
    expect(projectStatusGroup('Loss Tender')).toBe('lost');

    // Internal
    expect(projectStatusGroup('Internal Project')).toBe('internal');
  });
});

// ---------------------------------------------------------------------------
// B4 — DAL RPC error surfacing + params/no-org-id (AC-1002)
// ---------------------------------------------------------------------------

describe('transitionProject', () => {
  it('AC-1002: transitionProject surfaces the RPC 42501/P0001 error and sends {p_id,p_to,p_customer_contract_ref,p_contract_date} with no org_id (FR-PR-002/011)', async () => {
    // Error path: should throw
    makeRpcBuilder({ data: null, error: { message: 'illegal transition', code: 'P0001' } });
    await expect(transitionProject('p1', 'Won, Pending KoM')).rejects.toThrow('illegal transition');

    // Win call: success + correct args
    makeRpcBuilder({ data: null, error: null });
    await transitionProject('p1', 'Won, Pending KoM', { customerContractRef: 'CPO-9', contractDate: '2026-03-01' });
    expect(mockRpc).toHaveBeenCalledWith('transition_project', {
      p_id: 'p1',
      p_to: 'Won, Pending KoM',
      p_customer_contract_ref: 'CPO-9',
      p_contract_date: '2026-03-01',
    });

    // Non-win call: no opts → omit p_customer_contract_ref / p_contract_date
    makeRpcBuilder({ data: null, error: null });
    await transitionProject('p1', 'PQ Submitted');
    // Regenerated RPC arg types encode optional args as omit-not-null (types regen, P2 assembly).
    expect(mockRpc).toHaveBeenCalledWith('transition_project', {
      p_id: 'p1',
      p_to: 'PQ Submitted',
    });

    // No org_id in any call
    expect(JSON.stringify(mockRpc.mock.calls)).not.toContain('org_id');
  });
});

// ---------------------------------------------------------------------------
// B5 — listPipelineStageConfig shape + no-org-id (AC-1003)
// ---------------------------------------------------------------------------

describe('listPipelineStageConfig', () => {
  it('AC-1003: listPipelineStageConfig selects (status, win_probability) from pipeline_stage_config, normalises win_probability to Number, sends no org_id (FR-PR-013)', async () => {
    makeFromBuilder({ data: [{ status: 'Leads', win_probability: '0.100' }], error: null });

    const result = await listPipelineStageConfig();

    expect(mockFrom).toHaveBeenCalledWith('pipeline_stage_config');
    expect(mockSelect).toHaveBeenCalledWith('status, win_probability');

    // Normalised to number
    expect(result[0].win_probability).toBe(0.1);
    expect(typeof result[0].win_probability).toBe('number');

    // No org_id
    expect(JSON.stringify(mockFrom.mock.calls)).not.toContain('org_id');
    expect(JSON.stringify(mockSelect.mock.calls)).not.toContain('org_id');
  });

  it('throws on PostgREST error', async () => {
    makeFromBuilder({ data: null, error: { message: 'select failed' } });
    await expect(listPipelineStageConfig()).rejects.toThrow('select failed');
  });
});
