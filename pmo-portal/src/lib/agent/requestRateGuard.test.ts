import { describe, it, expect, vi } from 'vitest';
import {
  checkRequestRate,
  type RequestRateSupabaseLike,
} from '../../../../supabase/functions/_shared/requestRateGuard';

// AC-RL-001: the request-rate guard maps the fixed-window rate_limit_hit() RPC to an
// {exceeded, retryAfterSeconds} decision and FAILS OPEN on any RPC error (availability defense —
// a limiter glitch must never turn into a self-inflicted outage). IG-audit 2026-07-10, migration 0091.

function stub(result: { data: unknown; error: unknown }): {
  supabase: RequestRateSupabaseLike;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn().mockResolvedValue(result);
  return { supabase: { rpc } as unknown as RequestRateSupabaseLike, rpc };
}

describe('checkRequestRate (AC-RL-001)', () => {
  it('allows when the RPC reports still-under-limit (data:true)', async () => {
    const { supabase } = stub({ data: true, error: null });
    const r = await checkRequestRate(supabase, { key: 'agent-chat:u1', limit: 20, windowSecs: 60 });
    expect(r).toEqual({ exceeded: false, retryAfterSeconds: 0 });
  });

  it('throttles with Retry-After = windowSecs when the RPC reports over-limit (data:false)', async () => {
    const { supabase } = stub({ data: false, error: null });
    const r = await checkRequestRate(supabase, { key: 'agent-chat:u1', limit: 20, windowSecs: 60 });
    expect(r).toEqual({ exceeded: true, retryAfterSeconds: 60 });
  });

  it('passes the key/limit/window through to the RPC verbatim', async () => {
    const { supabase, rpc } = stub({ data: true, error: null });
    await checkRequestRate(supabase, { key: 'agent-chat:u9', limit: 5, windowSecs: 30 });
    expect(rpc).toHaveBeenCalledWith('rate_limit_hit', {
      p_key: 'agent-chat:u9',
      p_limit: 5,
      p_window_secs: 30,
    });
  });

  it('fails OPEN when the RPC returns an error', async () => {
    const { supabase } = stub({ data: null, error: { message: 'boom' } });
    const r = await checkRequestRate(supabase, { key: 'agent-chat:u1', limit: 20, windowSecs: 60 });
    expect(r).toEqual({ exceeded: false, retryAfterSeconds: 0 });
  });

  it('fails OPEN when the RPC returns a non-boolean result', async () => {
    const { supabase } = stub({ data: 'unexpected', error: null });
    const r = await checkRequestRate(supabase, { key: 'agent-chat:u1', limit: 20, windowSecs: 60 });
    expect(r).toEqual({ exceeded: false, retryAfterSeconds: 0 });
  });

  it('fails OPEN when the RPC throws', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('network'));
    const supabase = { rpc } as unknown as RequestRateSupabaseLike;
    const r = await checkRequestRate(supabase, { key: 'agent-chat:u1', limit: 20, windowSecs: 60 });
    expect(r).toEqual({ exceeded: false, retryAfterSeconds: 0 });
  });
});
