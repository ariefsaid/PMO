// Dashboard fragment owned by slice S4 (#1532). Nobody else edits this file.
// erp_push_outcome is emitted by emitErpPushOutcome (adapter-dispatch/moneyOutboxDeps.ts): one event per outbox
// transition (confirmed | failed | held | quarantined). Codes and counts only, no amounts or names.
import { trend, hogql, NS } from '../queryBuilders.mjs';

const notConfirmed = [{ key: 'outcome', value: ['confirmed'], operator: 'is_not', type: 'event' }];
const heldOrQuarantined = [{ key: 'outcome', value: ['held', 'quarantined'], operator: 'exact', type: 'event' }];
const quarantined = [{ key: 'outcome', value: ['quarantined'], operator: 'exact', type: 'event' }];
const last7d = (q) => ({ ...q, source: { ...q.source, dateRange: { date_from: '-7d' } } });

export default [
  {
    dashboard: `${NS} Money pushes`,
    description:
      'ERP push outcomes per outbox transition: confirmed, failed, held, quarantined. Source: erp_push_outcome '
      + '(server event, no user id, no amounts). Empty when PMO is standalone (no external tier) — by design (ADR-0094).',
    insights: [
      {
        name: `${NS} Money pushes — outcomes per domain per day`,
        query: trend([{ event: 'erp_push_outcome', label: 'outcomes' }], { breakdown: 'domain' }),
      },
      {
        name: `${NS} Money pushes — outcomes by kind`,
        query: trend([{ event: 'erp_push_outcome', label: 'outcomes' }], { breakdown: 'outcome' }),
      },
      {
        name: `${NS} Money pushes — failure rate per day`,
        query: hogql(`SELECT toDate(timestamp) AS day, countIf(properties.outcome = 'failed') AS failed, count() AS outcomes, round(failed / outcomes, 3) AS failure_rate
FROM events WHERE event = 'erp_push_outcome' AND timestamp > now() - INTERVAL 30 DAY
GROUP BY day ORDER BY day`),
      },
      {
        name: `${NS} Money pushes — top error codes (not confirmed)`,
        query: trend([{ event: 'erp_push_outcome', label: 'not confirmed' }], { breakdown: 'error_code', display: 'ActionsBarValue', properties: notConfirmed }),
      },
      {
        // The dashboard cannot show "currently held": the outbox row is the record. This counts transitions.
        name: `${NS} Money pushes — held or quarantined in the last 7 days (transitions, not current state)`,
        query: last7d(trend([{ event: 'erp_push_outcome', label: 'held/quarantined' }], { breakdown: 'outcome', display: 'ActionsBarValue', properties: heldOrQuarantined })),
      },
      {
        // Alert C reads this tile: an ERP outage leaves rows `committing`, the sweep quarantines them (no `failed` event).
        name: `${NS} Money pushes — quarantined per domain per day`,
        query: trend([{ event: 'erp_push_outcome', label: 'quarantined' }], { breakdown: 'domain', properties: quarantined }),
      },
      {
        name: `${NS} Money pushes — push duration p95 (ms)`,
        query: trend([{ event: 'erp_push_outcome', label: 'p95 ms', math: 'p95', mathProperty: 'duration_ms' }], { breakdown: 'domain' }),
      },
    ],
  },
];
