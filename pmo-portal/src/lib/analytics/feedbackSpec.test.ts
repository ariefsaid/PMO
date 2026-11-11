import { describe, it, expect } from 'vitest';
import feedback from '../../../../scripts/posthog/spec/feedback.mjs';
import { SPEC } from '../../../../scripts/posthog/dashboardSpec.mjs';

type Tile = { name: string; query: { source: { series: Array<{ event: string }>; breakdownFilter?: { breakdown: string }; properties?: Array<{ key: string; value: string[] }> } } };
const dash = (feedback as Array<{ dashboard: string; insights: Tile[] }>)[0];

describe('AC-PHO-108 Feedback & Surveys dashboard', () => {
  it('is part of the provisioned spec, next to usage and AI quality', () => {
    const names = (SPEC as Array<{ dashboard: string }>).map((d) => d.dashboard);
    expect(names).toContain('[PMO] Feedback & Surveys');
    expect(names).toContain('[PMO] AI · Cost & Quality');
    expect(names).toContain('[PMO] Usage per org (observed use)');
  });

  it('shows funnel health per survey: shown, answered, dismissed', () => {
    const t = dash.insights.find((i) => /shown.*answered.*dismissed/i.test(i.name))!;
    expect(t.query.source.series.map((s) => s.event)).toEqual(['survey shown', 'survey sent', 'survey dismissed']);
    expect(t.query.source.breakdownFilter?.breakdown).toBe('$survey_name');
  });

  it.each([
    ['NPS', '[PMO] NPS'],
    ['First core flow', '[PMO] First core flow'],
  ])('shows the %s answer distribution from the answer property', (label, survey) => {
    const t = dash.insights.find((i) => i.name.includes(label) && /answers/i.test(i.name))!;
    expect(t.query.source.series[0].event).toBe('survey sent');
    expect(t.query.source.breakdownFilter?.breakdown).toBe('$survey_response');
    expect(t.query.source.properties?.[0]).toMatchObject({ key: '$survey_name', value: [survey] });
  });

  it('shows feedback by module and by org (context keys the app attaches)', () => {
    const byModule = dash.insights.find((i) => /by module/i.test(i.name))!;
    expect(byModule.query.source.breakdownFilter?.breakdown).toBe('module');
    const byOrg = dash.insights.find((i) => /by org/i.test(i.name))!;
    expect(byOrg.query.source.breakdownFilter?.breakdown).toBe('org_id');
  });

  it('every tile name is unique and namespaced (the upsert key)', () => {
    const names = dash.insights.map((i) => i.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((n) => n.startsWith('[PMO] '))).toBe(true);
  });
});
