// Dashboard fragment owned by slice S5 (#1532). Nobody else edits this file.
import { trend, NS } from '../queryBuilders.mjs';

export default [
  {
    dashboard: `${NS} Usage per org (observed use)`,
    description:
      'Observed use — browser events, best effort (ad blockers, opt-out). Not a record; nothing commercial reads from it.',
    insights: [
      {
        name: `${NS} Usage per org — business events per week`,
        query: trend(
          [
            { event: 'budget_activated', label: 'budgets activated' },
            { event: 'invoice_issued', label: 'invoices issued' },
            { event: 'payment_recorded', label: 'payments recorded' },
            { event: 'purchase_approved', label: 'purchases approved' },
          ],
          { breakdown: 'org_id', interval: 'week', display: 'ActionsTable' },
        ),
      },
    ],
  },
];
