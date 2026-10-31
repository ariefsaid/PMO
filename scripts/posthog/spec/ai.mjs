// Dashboard fragment owned by slice S1 (#1532). Nobody else edits this file.
// Server events: $ai_generation / $ai_span / $ai_trace / ai_eval (supabase/functions/agent-chat/aiTelemetry.ts).
// `user_id` exists only on events whose user sent the analytics-consent flag, so per-user tiles
// cover consenting users only (and are labelled so).
import { trend, NS } from '../queryBuilders.mjs';

const isError = [{ key: '$ai_is_error', value: ['true'], operator: 'exact', type: 'event' }];
const failed = [{ key: 'eval_pass', value: ['false'], operator: 'exact', type: 'event' }];
const cost = { event: '$ai_generation', label: 'cost (USD)', math: 'sum', mathProperty: '$ai_total_cost_usd' };

export default [
  {
    dashboard: `${NS} AI · Cost & Quality`,
    description: 'Assistant cost, tokens, tool health, run errors and online-eval verdicts. Source: server events $ai_generation, $ai_span, $ai_trace, ai_eval (numbers and codes; demo org also carries text).',
    insights: [
      { name: `${NS} AI cost per org per day`, query: trend([cost], { breakdown: 'org_id' }) },
      { name: `${NS} AI cost per user per day (consenting users only)`, query: trend([cost], { breakdown: 'user_id' }) },
      { name: `${NS} AI cost per day (alert source)`, query: trend([cost]) },
      {
        name: `${NS} AI tokens by model`,
        query: trend([
          { event: '$ai_generation', label: 'input tokens', math: 'sum', mathProperty: '$ai_input_tokens' },
          { event: '$ai_generation', label: 'output tokens', math: 'sum', mathProperty: '$ai_output_tokens' },
        ], { breakdown: '$ai_model' }),
      },
      { name: `${NS} AI cost by model`, query: trend([cost], { breakdown: '$ai_model', display: 'ActionsBarValue' }) },
      { name: `${NS} AI generations by model`, query: trend([{ event: '$ai_generation', label: 'generations' }], { breakdown: '$ai_model', display: 'ActionsBarValue' }) },
      { name: `${NS} AI tool calls by tool`, query: trend([{ event: '$ai_span', label: 'tool calls' }], { breakdown: '$ai_span_name', display: 'ActionsBarValue' }) },
      {
        name: `${NS} AI tool errors by tool`,
        query: trend([{ event: '$ai_span', label: 'tool errors' }], { breakdown: '$ai_span_name', display: 'ActionsBarValue', properties: isError }),
      },
      {
        name: `${NS} AI slowest tools (p95 seconds)`,
        query: trend([{ event: '$ai_span', label: 'p95 latency', math: 'p95', mathProperty: '$ai_latency' }], { breakdown: '$ai_span_name', display: 'ActionsBarValue' }),
      },
      { name: `${NS} AI runs per day`, query: trend([{ event: '$ai_trace', label: 'runs' }]) },
      { name: `${NS} AI run errors per day (alert source)`, query: trend([{ event: '$ai_trace', label: 'errored runs' }], { properties: isError }) },
      { name: `${NS} AI run errors by code`, query: trend([{ event: '$ai_trace', label: 'errored runs' }], { breakdown: 'error_code', display: 'ActionsBarValue', properties: isError }) },
      // Thumbs-down rate by model: a cross-event join is not expressible in TrendsQuery (docs/posthog-dashboards.md § S1 AI),
      // so ratings and generations sit side by side; agent_feedback_rated.run_id equals $ai_trace_id for ad-hoc joins.
      { name: `${NS} AI feedback by rating`, query: trend([{ event: 'agent_feedback_rated' }], { breakdown: 'rating', display: 'ActionsBarValue' }) },
      { name: `${NS} AI online-eval verdicts by name`, query: trend([{ event: 'ai_eval', label: 'verdicts' }], { breakdown: 'eval_name', display: 'ActionsBarValue' }) },
      { name: `${NS} AI online-eval failures by name`, query: trend([{ event: 'ai_eval', label: 'failed verdicts' }], { breakdown: 'eval_name', display: 'ActionsBarValue', properties: failed }) },
    ],
  },
];
