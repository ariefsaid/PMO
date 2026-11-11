// Dashboard fragment owned by slice S6 (#1532). Nobody else edits this file.
// Same dashboard name as the shipped Demo dashboard: provision() shares one dashboard per name.
import { funnel, NS } from '../queryBuilders.mjs';

export default [
  {
    dashboard: `${NS} Demo · Prospect Funnel`,
    description:
      'Prospect demo journeys. The money-path funnel shows the furthest step each demo account reaches; ' +
      'a persona whose role cannot perform a step stops there (FR-PHO-051).',
    insights: [
      {
        name: `${NS} Demo · Money path (project → budget → purchase → invoice)`,
        query: funnel(['project_detail_opened', 'budget_activated', 'purchase_approved', 'invoice_issued'], {
          properties: [{ type: 'event', key: 'demo_audience', operator: 'exact', value: ['prospect'] }],
          breakdown: 'demo_account',
        }),
      },
    ],
  },
];
