import { test, expect } from '@playwright/test';
import { login } from './helpers';

/**
 * AC-ACD-010 — Administration › Usage shows the agent cost dashboard.
 *
 * Curated E2E journey (ADR-0010 — one journey per cross-stack AC). An Admin opens
 * /administration and the Agent cost overview panel renders cache hit-rate, reasoning share,
 * cost/run, and latency from the aggregates-only usage RPCs.
 *
 * The two org RPCs are intercepted (page.route) so the panel has deterministic data regardless of
 * seed — the AC under test is that the mounted panel RENDERS the derived metrics, not the seed
 * values. Both are rest/v1/rpc POSTs (supabase-js .rpc()); admin@acme.test is an
 * org-Admin (not a platform Operator), so the org_* variants are the ones called.
 *
 * Goal oracle: the "Cache hit-rate" tile shows 60.0% (= 100·Σcached 600 / Σprompt 1000).
 *
 * Verify parse (no live server needed):
 *   npx playwright test e2e/AC-ACD-010-agent-cost-dashboard.spec.ts --list
 */

test.setTimeout(120_000);

const SUMMARY_ROWS = [
  {
    owner_id: null,
    action: 'chat',
    month: '2026-06-01',
    run_count: 4,
    prompt_tokens: 1000,
    completion_tokens: 200,
    cached_tokens: 600,
    reasoning_tokens: 40,
    cost: 0.05,
    margin_usd: null,
  },
];

const RUN_STATS_ROWS = [
  {
    action: 'chat',
    month: '2026-06-01',
    runs: 4,
    avg_rounds: 2,
    p50_cost: 0.01,
    p95_cost: 0.02,
    max_cost: 0.03,
    cache_hit_pct: 60,
    p50_ms: 500,
    p95_ms: 900,
  },
];

test('AC-ACD-010 an Admin opens Administration › Usage and the agent cost panel renders the derived metrics', async ({
  page,
}) => {
  // Intercept the two aggregates-only RPCs BEFORE navigation (they fire on mount).
  await page.route('**/rest/v1/rpc/org_agent_run_stats', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RUN_STATS_ROWS) });
  });
  await page.route('**/rest/v1/rpc/org_usage_summary', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SUMMARY_ROWS) });
  });

  await login(page, 'admin@acme.test');
  await page.goto('/administration');

  // The Usage section + the mounted cost panel.
  const panel = page.getByRole('main');
  await expect(panel.getByRole('heading', { name: /agent cost overview/i })).toBeVisible({ timeout: 20_000 });

  // Goal oracle: cache hit-rate tile = 60.0% (100·600/1000). Scope to the tile label to avoid
  // matching the chart. StatTiles renders the label + value together.
  await expect(panel.getByText('Cache hit-rate')).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByText('60.0%')).toBeVisible({ timeout: 10_000 });

  // The other tiles are present (structure, not exact values).
  await expect(panel.getByText('Reasoning share')).toBeVisible();
  await expect(panel.getByText(/Latency \(p95/i)).toBeVisible();
});
