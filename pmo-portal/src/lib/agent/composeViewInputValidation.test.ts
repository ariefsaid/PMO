/**
 * composeViewHandler input-type validation (FR-AS-012 hardening, T-10 #1538 slice 2).
 *
 * The prompt gate previously only checked truthiness + .length, so a JSON body like
 * {"prompt": 123} or {"prompt": ["a"]} slipped past the 400 gate and carried the raw
 * non-string value into the model request payload. A wholly non-object body (JSON null)
 * crashed the handler on property access before any gate ran.
 *
 * The gate contract: any request whose prompt is not a string (or whose body is not an
 * object) is rejected 400 BAD_REQUEST before the profiles lookup, rate guard, or model
 * call — mirroring the typed 400 the wrapper returns for a non-object JSON body.
 */
import { it, expect, vi } from 'vitest';
import { composeViewHandler } from '../../../../supabase/functions/compose-view/handler';
import type { HandlerDeps } from '../../../../supabase/functions/compose-view/handler';
import type { ComposeViewRequest } from '../agent/types';
import type { CompositionSpec } from '../viewspec/types';

const VALID_SPEC: CompositionSpec = {
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
};

function mockSupabaseWithOrg(orgId: string): HandlerDeps['supabase'] {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { org_id: orgId }, error: null }),
        }),
      }),
    }),
  } as unknown as HandlerDeps['supabase'];
}

function deps(): HandlerDeps {
  return {
    modelClient: {
      create: vi.fn().mockResolvedValue({
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'compose_view', arguments: JSON.stringify(VALID_SPEC) } }],
        },
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        model: 'deepseek/deepseek-v4-flash',
      }),
    },
    model: 'deepseek/deepseek-v4-flash',
    supabase: mockSupabaseWithOrg('org-1'),
    userId: 'u-1',
  };
}

it.each([
  ['a number', 1234],
  ['an array', ['show projects']],
  ['an object', { text: 'show projects' }],
  ['a boolean', true],
])('returns 400 BAD_REQUEST without calling the model when prompt is %s', async (_label, prompt) => {
  const d = deps();
  const result = await composeViewHandler({ prompt, orgId: 'org-1' } as unknown as ComposeViewRequest, d);

  expect(result.status).toBe(400);
  if (result.status === 400) {
    expect(result.body.error).toBe('BAD_REQUEST');
    expect(result.body.detail).toBe('prompt');
  }
  expect(d.modelClient.create).not.toHaveBeenCalled();
  expect((d.supabase.from as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
});

it('returns 400 BAD_REQUEST instead of throwing when the request body is not an object (JSON null)', async () => {
  const d = deps();
  const result = await composeViewHandler(null as unknown as ComposeViewRequest, d);

  expect(result.status).toBe(400);
  if (result.status === 400) {
    expect(result.body.error).toBe('BAD_REQUEST');
    expect(result.body.detail).toBe('prompt');
  }
  expect(d.modelClient.create).not.toHaveBeenCalled();
});

it('still accepts a valid string prompt (control)', async () => {
  const d = deps();
  const result = await composeViewHandler({ prompt: 'show projects', orgId: 'org-1' }, d);
  expect(result.status).toBe(200);
  expect(d.modelClient.create).toHaveBeenCalledTimes(1);
});
