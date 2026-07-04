/**
 * dispatcher.condition.test.ts — NL trigger-condition evaluation (ADR-0044 §4, FR-AAN-021..025).
 * AC-AAN-023/024/025. [REC-1]: logic lives in supabase/functions/agent-dispatch/*, tests live here.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  evaluateCondition,
  makeConditionMemo,
  CONDITION_MEMO_TTL_MS,
} from '../../../../../supabase/functions/agent-dispatch/condition';
import type { AutomationRow, StatusEventRow } from '../../../../../supabase/functions/agent-dispatch/dispatcher';

function makeAutomation(overrides: Partial<AutomationRow> = {}): AutomationRow {
  return {
    id: 'trig-1',
    kind: 'trigger',
    owner_id: 'u1',
    org_id: 'org-A',
    prompt: 'notify me',
    trigger_on: { source: 'procurement_status_events', event: 'Ordered' },
    condition: 'the case has sat in Ordered for more than 30 days',
    enabled: true,
    archived_at: null,
    ...overrides,
  };
}

const event: StatusEventRow = { id: 'evt-1', created_at: '2026-07-06T08:00:00Z', to_status: 'Ordered', org_id: 'org-A' };

describe('evaluateCondition', () => {
  it('AC-AAN-023 condition false no-fire no notification', async () => {
    const model = {
      create: vi.fn().mockResolvedValue({
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'false' },
        model: 'cheap-model',
      }),
    };
    const memo = makeConditionMemo();
    const result = await evaluateCondition(
      { model, modelId: 'cheap-model', now: () => 0, memo },
      makeAutomation(),
      event,
    );
    expect(result).toEqual({ fire: false });
  });

  it('AC-AAN-024 condition ambiguous no-fire plus warning notification (model throws)', async () => {
    const model = { create: vi.fn().mockRejectedValue(new Error('model unavailable')) };
    const memo = makeConditionMemo();
    const result = await evaluateCondition(
      { model, modelId: 'cheap-model', now: () => 0, memo },
      makeAutomation(),
      event,
    );
    expect(result.fire).toBe(false);
    expect(result.warning).toMatch(/couldn't evaluate the condition for automation trig-1/);
  });

  it('AC-AAN-024 condition ambiguous no-fire plus warning notification (unparseable text)', async () => {
    const model = {
      create: vi.fn().mockResolvedValue({
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'maybe?' },
        model: 'cheap-model',
      }),
    };
    const memo = makeConditionMemo();
    const result = await evaluateCondition(
      { model, modelId: 'cheap-model', now: () => 0, memo },
      makeAutomation(),
      event,
    );
    expect(result.fire).toBe(false);
    expect(result.warning).toMatch(/couldn't evaluate the condition for automation trig-1/);
  });

  it('AC-AAN-025 condition evaluation is memoized within the TTL', async () => {
    const model = {
      create: vi.fn().mockResolvedValue({
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'true' },
        model: 'cheap-model',
      }),
    };
    const memo = makeConditionMemo();
    let clock = 1000;
    const deps = { model, modelId: 'cheap-model', now: () => clock, memo };
    const automation = makeAutomation();

    await evaluateCondition(deps, automation, event);
    clock += 1000; // still within TTL
    await evaluateCondition(deps, automation, event);
    clock += 1000; // still within TTL
    const third = await evaluateCondition(deps, automation, event);

    expect(model.create).toHaveBeenCalledTimes(1);
    expect(third).toEqual({ fire: true });
  });

  it('re-evaluates after the memo TTL expires', async () => {
    const model = {
      create: vi.fn().mockResolvedValue({
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'true' },
        model: 'cheap-model',
      }),
    };
    const memo = makeConditionMemo();
    let clock = 0;
    const deps = { model, modelId: 'cheap-model', now: () => clock, memo };
    const automation = makeAutomation();

    await evaluateCondition(deps, automation, event);
    clock += CONDITION_MEMO_TTL_MS + 1;
    await evaluateCondition(deps, automation, event);

    expect(model.create).toHaveBeenCalledTimes(2);
  });
});
