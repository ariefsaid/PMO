// The dashboard spec (name → tiles). Per-slice fragments live in ./spec/*.mjs (S0 pre-creates one file each).
import { trend, funnel, NS } from './queryBuilders.mjs';
import ai from './spec/ai.mjs';
import jobs from './spec/jobs.mjs';
import pushes from './spec/pushes.mjs';
import usage from './spec/usage.mjs';
import demo from './spec/demo.mjs';
import feedback from './spec/feedback.mjs';

const LEGACY_SPEC = [
  {
    dashboard: `${NS} Agent · Adoption & Reliability`,
    description: 'Agent panel usage, run outcomes, approval funnel, latency. Source: agent_* events.',
    insights: [
      { name: `${NS} Agent panel opens (daily)`, query: trend([{ event: 'agent_panel_opened' }]) },
      {
        name: `${NS} Agent runs — started / completed / errored`,
        query: trend([
          { event: 'agent_run_started', label: 'started' },
          { event: 'agent_run_completed', label: 'completed' },
          { event: 'agent_run_errored', label: 'errored' },
        ]),
      },
      {
        name: `${NS} Agent run errors by code`,
        query: trend([{ event: 'agent_run_errored' }], { breakdown: 'error_code', display: 'ActionsBarValue' }),
      },
      {
        name: `${NS} Agent approval funnel (shown → decided)`,
        query: funnel(['agent_approval_shown', 'agent_approval_decided']),
      },
      {
        name: `${NS} Agent approval decisions (approved / denied)`,
        query: trend([{ event: 'agent_approval_decided' }], { breakdown: 'decision', display: 'ActionsBarValue' }),
      },
      {
        name: `${NS} Agent run latency — avg duration_ms`,
        query: trend([{ event: 'agent_run_completed', label: 'avg ms', math: 'avg', mathProperty: 'duration_ms' }]),
      },
      {
        name: `${NS} Agent tool rounds — avg`,
        query: trend([{ event: 'agent_run_completed', label: 'avg rounds', math: 'avg', mathProperty: 'tool_round_count' }]),
      },
      {
        name: `${NS} Agent feedback by rating`,
        query: trend([{ event: 'agent_feedback_rated' }], { breakdown: 'rating', display: 'ActionsBarValue' }),
      },
      { name: `${NS} Agent threads resumed`, query: trend([{ event: 'agent_thread_resumed' }]) },
    ],
  },
  {
    dashboard: `${NS} Auth · Login Health`,
    description: 'Login success/failure, failure reasons, logout. Source: auth_* events.',
    insights: [
      {
        name: `${NS} Logins — success vs failed`,
        query: trend([
          { event: 'auth_login_succeeded', label: 'succeeded' },
          { event: 'auth_login_failed', label: 'failed' },
        ]),
      },
      {
        name: `${NS} Login failures by reason`,
        query: trend([{ event: 'auth_login_failed' }], { breakdown: 'reason_code', display: 'ActionsBarValue' }),
      },
      { name: `${NS} Logouts`, query: trend([{ event: 'auth_logout_succeeded' }]) },
    ],
  },
  {
    dashboard: `${NS} Product · Usage & Friction`,
    description: 'Navigation, detail opens, search/filter, and friction (validation/save/permission). Source: product events.',
    insights: [
      {
        name: `${NS} Top routes viewed`,
        query: trend([{ event: 'app_route_viewed' }], { breakdown: 'route', display: 'ActionsBarValue' }),
      },
      {
        name: `${NS} Detail opens — project vs procurement`,
        query: trend([
          { event: 'project_detail_opened', label: 'project' },
          { event: 'procurement_detail_opened', label: 'procurement' },
        ]),
      },
      {
        name: `${NS} Search & filter usage`,
        query: trend([
          { event: 'search_used', label: 'search' },
          { event: 'filter_applied', label: 'filter' },
        ]),
      },
      {
        name: `${NS} Empty states seen by module`,
        query: trend([{ event: 'empty_state_seen' }], { breakdown: 'module', display: 'ActionsBarValue' }),
      },
      {
        name: `${NS} Save failures by reason`,
        query: trend([{ event: 'save_failed' }], { breakdown: 'reason_code', display: 'ActionsBarValue' }),
      },
      {
        name: `${NS} Form validation failures by module`,
        query: trend([{ event: 'form_validation_failed' }], { breakdown: 'module', display: 'ActionsBarValue' }),
      },
    ],
  },
  {
    dashboard: `${NS} Demo · Prospect Funnel`,
    description:
      'Land -> persona selected -> login -> first module opened. Source: demo_persona_selected, ' +
      'auth_login_succeeded, app_route_viewed, coming_soon_clicked (FR-PHG-020/021).',
    insights: [
      {
        name: `${NS} Demo funnel — persona -> login -> module`,
        query: funnel(['demo_persona_selected', 'auth_login_succeeded', 'app_route_viewed']),
      },
      {
        name: `${NS} Demo personas chosen`,
        query: trend([{ event: 'demo_persona_selected' }], { breakdown: 'persona_role', display: 'ActionsBarValue' }),
      },
      {
        name: `${NS} Demo — first modules opened`,
        query: trend([{ event: 'app_route_viewed' }], { breakdown: 'route', display: 'ActionsBarValue' }),
      },
      {
        name: `${NS} Coming-soon demand by feature`,
        query: trend([{ event: 'coming_soon_clicked' }], { breakdown: 'feature_id', display: 'ActionsBarValue' }),
      },
    ],
  },
];

export const SPEC = [...LEGACY_SPEC, ...ai, ...jobs, ...pushes, ...usage, ...demo, ...feedback];
