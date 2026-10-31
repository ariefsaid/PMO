import { describe, it, expect } from 'vitest';
import { provision } from '../../../../scripts/posthog/provision.mjs';
import { SPEC } from '../../../../scripts/posthog/dashboardSpec.mjs';

function fakeIo() {
  const dashboards: { id: number; name: string }[] = [];
  const insights: { id: number; name: string }[] = [];
  let next = 1;
  return {
    dashboards, insights,
    io: {
      listDashboards: async () => dashboards.map((d) => ({ ...d, deleted: false })),
      listInsights: async () => insights.map((i) => ({ ...i, deleted: false })),
      createDashboard: async (b: { name: string }) => { const d = { id: next++, name: b.name }; dashboards.push(d); return d; },
      createInsight: async (b: { name: string }) => { const i = { id: next++, name: b.name }; insights.push(i); return i; },
      refreshInsight: async () => undefined,
      log: () => undefined,
    },
  };
}

describe('AC-PHO-050 provision is idempotent', () => {
  it('second run creates nothing', async () => {
    const f = fakeIo();
    const first = await provision(SPEC, f.io);
    expect(first.created.insights).toBeGreaterThan(0);
    const second = await provision(SPEC, f.io);
    expect(second.created).toEqual({ dashboards: 0, insights: 0 });
    expect(second.skipped.insights).toBe(first.created.insights);
  });
  it('two spec entries with one dashboard name share ONE dashboard (S6 adds to the Demo dashboard)', async () => {
    const f = fakeIo();
    const spec = [
      { dashboard: '[PMO] D', description: 'd', insights: [{ name: 'a', query: {} }] },
      { dashboard: '[PMO] D', description: 'd', insights: [{ name: 'b', query: {} }] },
    ];
    await provision(spec, f.io);
    expect(f.dashboards).toHaveLength(1);
    expect(f.insights).toHaveLength(2);
  });
});

describe('AC-PHO-007 AI dashboard tiles added after review (#1532)', () => {
  const tile = (name: string) => SPEC.flatMap((d: { insights: { name: string; query: unknown }[] }) => d.insights).find((i: { name: string }) => i.name.includes(name));
  it('thumbs-down rate by model joins the rating to its generation by trace id, excluding judge calls', () => {
    const q = JSON.stringify(tile('AI thumbs-down rate by model')?.query);
    expect(q).toContain('HogQLQuery');
    expect(q).toContain('agent_feedback_rated');
    expect(q).toContain('$ai_generation');
    expect(q).toContain('f.trace = g.trace');
    expect(q).toContain("'eval'");
  });
  it('judge spend has its own tile, filtered to action = eval', () => {
    const q = JSON.stringify(tile('AI judge (eval) cost per day')?.query);
    expect(q).toContain('$ai_total_cost_usd');
    expect(q).toContain('"key":"action"');
    expect(q).toContain('"value":["eval"]');
  });
});
