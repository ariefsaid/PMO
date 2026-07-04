/**
 * Quality-gate test on a hand-shaped deepseek/deepseek-v4-flash-realistic tool-forced
 * compose_view fixture (MC-OD-008 — see docs/plans/2026-07-03-agent-model-client.md §5
 * for live-run provenance status, recorded by the Director/Task 21).
 * AC-MC-022: structured-output validity on the first attempt (repairAttempts: 0).
 */
import { it, expect, vi } from 'vitest';
import { composeSpec } from '../../../../supabase/functions/compose-view/composeSpec';
import type { ComposeSpecDeps } from '../../../../supabase/functions/compose-view/composeSpec';

it('AC-MC-022 compose_view structured-output validity on the first attempt, deepseek-shaped fixture', async () => {
  const validSpecArgs = JSON.stringify({
    version: 1,
    panels: [
      {
        id: 'p1',
        primitive: 'KPITile',
        querySpec: {
          entity: 'projects',
          select: ['id'],
          aggregate: { fn: 'count', column: 'id', alias: 'count' },
        },
      },
    ],
  });

  const create = vi.fn().mockResolvedValueOnce({
    finish_reason: 'tool_calls',
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call_ghi789',
        type: 'function',
        function: { name: 'compose_view', arguments: validSpecArgs },
      }],
    },
    usage: { prompt_tokens: 500, completion_tokens: 80, total_tokens: 580 },
    model: 'deepseek/deepseek-v4-flash',
  });

  const deps: ComposeSpecDeps = { modelClient: { create }, userId: 'user-1', model: 'deepseek/deepseek-v4-flash' };
  const result = await composeSpec('show my projects by status', 'org-1', deps);

  expect(result.repairAttempts).toBe(0);
  expect(result.spec.panels).toHaveLength(1);
  expect(create).toHaveBeenCalledTimes(1);
});
