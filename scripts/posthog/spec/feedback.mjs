// Dashboard fragment owned by slice S9 (#1532). Nobody else edits this file.
// Source: PostHog's own survey events (`survey shown` / `survey sent` / `survey dismissed`), emitted by the
// SDK when the app opens one of the four published surveys. The names carry a space, so
// scripts/check-dashboard-tiles.mjs (which reads `[a-z0-9_$]+` names) does not parse them: the provisioning
// test pmo-portal/src/lib/analytics/feedbackSpec.test.ts owns these tiles instead.
// `module`, `route`, `run_id` ride on the answer from the app; `org_id` is a registered super property.
import { trend, NS } from '../queryBuilders.mjs';

const survey = (name) => [{ key: '$survey_name', value: [name], operator: 'exact', type: 'event' }];
const answered = (label) => ({ event: 'survey sent', label });

export default [
  {
    dashboard: `${NS} Feedback & Surveys`,
    description:
      'Feedback button, "what went wrong?" after a thumbs-down, first-core-flow 1-5 and quarterly NPS. Source: PostHog survey events. ' +
      'Answers carry no record contents; at most one prompted survey per user per 30 days (PostHog wait period).',
    insights: [
      {
        name: `${NS} Surveys: shown, answered, dismissed`,
        query: trend(
          [
            { event: 'survey shown', label: 'shown' },
            { event: 'survey sent', label: 'answered' },
            { event: 'survey dismissed', label: 'dismissed' },
          ],
          { breakdown: '$survey_name', interval: 'week', display: 'ActionsTable' },
        ),
      },
      {
        name: `${NS} NPS answers`,
        query: trend([answered('NPS')], { breakdown: '$survey_response', display: 'ActionsBarValue', properties: survey('[PMO] NPS') }),
      },
      {
        name: `${NS} First core flow answers (1-5)`,
        query: trend([answered('ease')], { breakdown: '$survey_response', display: 'ActionsBarValue', properties: survey('[PMO] First core flow') }),
      },
      {
        name: `${NS} Feedback sent by module`,
        query: trend([answered('feedback')], { breakdown: 'module', display: 'ActionsBarValue', properties: survey('[PMO] Feedback') }),
      },
      {
        name: `${NS} Feedback and answers by org`,
        query: trend([answered('answers')], { breakdown: 'org_id', interval: 'week', display: 'ActionsTable' }),
      },
      {
        name: `${NS} What went wrong, per day`,
        query: trend([answered('what went wrong')], { properties: survey('[PMO] Assistant: what went wrong?') }),
      },
    ],
  },
];
