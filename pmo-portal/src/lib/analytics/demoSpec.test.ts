import { describe, it, expect } from 'vitest';
import { SPEC } from '../../../../scripts/posthog/dashboardSpec.mjs';

type Insight = { name: string; query: { source: any } };
type Entry = { dashboard: string; insights: Insight[] };
const spec = SPEC as Entry[];

describe('AC-PHO-050 Demo · Money path funnel', () => {
  const ins = spec.flatMap((d) => d.insights).find((i) => i.name.includes('Money path'));

  it('is prospect-only, ordered project → budget → purchase → invoice, broken down by account', () => {
    expect(ins).toBeTruthy();
    const q = ins!.query.source;
    expect(q.kind).toBe('FunnelsQuery');
    expect(q.series.map((s: { event: string }) => s.event)).toEqual([
      'project_detail_opened', 'budget_activated', 'purchase_approved', 'invoice_issued',
    ]);
    expect(q.properties).toEqual([{ type: 'event', key: 'demo_audience', operator: 'exact', value: ['prospect'] }]);
    expect(q.breakdownFilter).toEqual({ breakdown_type: 'event', breakdown: 'demo_account' });
  });

  it('lives on the existing Demo dashboard, which says what role limits do to the funnel (FR-PHO-051)', () => {
    const demo = spec.filter((d) => d.dashboard === '[PMO] Demo · Prospect Funnel');
    expect(demo.some((d) => d.insights.some((i) => i.name.includes('Money path')))).toBe(true);
    expect(demo.map((d) => (d as unknown as { description: string }).description).join(' ')).toMatch(/furthest step/i);
  });
});
