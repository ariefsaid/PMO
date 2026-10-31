// Query builders (HogQL InsightVizNode — verified shapes). Moved verbatim from provision-dashboards.mjs (S0, #1532).
// `properties` = optional array of PostHog property filters, passed as source.properties.
export const DATE_FROM = '-30d';
export const NS = '[PMO]'; // name prefix so provisioned objects are greppable + upsert-keyed

export function trend(series, { breakdown, interval = 'day', display, properties } = {}) {
  return {
    kind: 'InsightVizNode',
    source: {
      kind: 'TrendsQuery',
      dateRange: { date_from: DATE_FROM },
      interval,
      series: series.map((s) => ({
        kind: 'EventsNode',
        event: s.event,
        name: s.label || s.event,
        math: s.math || 'total',
        ...(s.mathProperty ? { math_property: s.mathProperty } : {}),
      })),
      ...(breakdown
        ? { breakdownFilter: { breakdown_type: 'event', breakdown } }
        : {}),
      trendsFilter: display ? { display } : {},
      ...(properties ? { properties } : {}),
    },
  };
}

export function funnel(events, { interval = 'day', properties, breakdown } = {}) {
  return {
    kind: 'InsightVizNode',
    source: {
      kind: 'FunnelsQuery',
      dateRange: { date_from: DATE_FROM },
      interval,
      series: events.map((e) => ({ kind: 'EventsNode', event: e, name: e })),
      funnelsFilter: {},
      ...(properties ? { properties } : {}),
      ...(breakdown ? { breakdownFilter: { breakdown_type: 'event', breakdown } } : {}),
    },
  };
}

/** A SQL (HogQL) insight, for what TrendsQuery cannot express (cross-event joins). */
export function hogql(query) {
  return { kind: 'DataVisualizationNode', source: { kind: 'HogQLQuery', query } };
}
