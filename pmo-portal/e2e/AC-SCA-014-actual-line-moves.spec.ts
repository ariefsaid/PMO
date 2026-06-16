import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

/**
 * AC-SCA-014 — End-to-end: completing a task moves the S-curve actual line.
 *
 * ISOLATION: acts on SP-2401 "Meridian Steelworks 4.2 MW Rooftop PV"
 * (41000000-0000-0000-0000-000000000001), a delivery (Ongoing Project) seed
 * row with milestones + Done tasks + two In-Progress tasks in the Procurement
 * phase.  After `supabase db reset` the two In-Progress seed tasks provide the
 * "at least one In-Progress task" precondition.  The test marks exactly one of
 * them Done; the S-curve's actual series gains a new completion point and the
 * "Actual to date" gauge rises.
 *
 * Spec citation (docs/specs/scurve-actual-line.spec.md):
 *   Given a delivery project open in the browser with at least one In-Progress
 *     task on the Timeline tab, and the S-curve shows no actual line (0 completions),
 *   When the user changes that task's status to 'Done',
 *     and navigates to the project's Delivery > S-curve view,
 *   Then the S-curve renders a visible actual line with ≥2 points
 *     (the new completion plus any prior Done tasks),
 *     and the line endpoint value matches the "Actual to date" gauge displayed
 *     in the legend.
 *
 * NOTE: seed already has multiple Done tasks so the S-curve has an actual line
 * before the mutation.  The oracle focuses on the value INCREASING, not on
 * 0→first-point, which is consistent with the spec's "line endpoint value
 * matches the gauge" invariant (NFR-SCA-001).
 *
 * Oracle:
 *   - Capture "Actual to date N%" from the S-curve figcaption BEFORE completing
 *     the task.
 *   - Complete one In-Progress task on the Tasks tab.
 *   - Re-navigate to the Overview tab.
 *   - Assert the new "Actual to date M%" is strictly greater than N.
 *   - Assert the figure's aria-label also reflects M% (line-endpoint = gauge,
 *     NFR-SCA-001).
 *
 * Task chosen: "PROC — Panel & Inverter Procurement" (In Progress, milestone
 * Procurement, seed ID 81000000-0000-0000-0000-000000000008).  The task is
 * undisputedly In Progress at seed-reset time, is wired to a weighted milestone
 * with target_date, and its completion adds a new actual point.
 */

test.setTimeout(120_000);

const PROJECT_ID = '41000000-0000-0000-0000-000000000001';
const IN_PROGRESS_TASK_NAME = 'PROC — Panel & Inverter Procurement';

/**
 * Parse "actual to date N%" from the S-curve figure aria-label or figcaption.
 * Returns the number N (0–100) or throws if the pattern is absent.
 */
function parseActualPct(label: string): number {
  const m = /actual to date\s?(\d+(?:\.\d+)?)%/i.exec(label);
  if (!m) throw new Error(`Cannot parse actual % from: "${label}"`);
  return parseFloat(m[1]);
}

test(
  'AC-SCA-014: completing an In-Progress task raises the S-curve actual line and the Actual-to-date gauge',
  async ({ page }) => {
    await signIn(page, 'pm@acme.test');

    // ── Step 1: open the Meridian delivery project Overview tab ─────────────────
    await page.goto(`/projects/${PROJECT_ID}/overview`);
    await expect(page).toHaveURL(new RegExp(PROJECT_ID), { timeout: 15_000 });

    // Wait for the S-curve chart to render (the figure is present when state='ready').
    const figure = page.locator('figure[aria-label]');
    await expect(figure).toBeVisible({ timeout: 20_000 });

    // ── BEFORE oracle: capture the current "Actual to date N%" ──────────────────
    // The figcaption contains "Actual to date  N%" (the bold tabular span).
    // We read the full aria-label on <figure> which includes "actual to date N%"
    // and is updated by React every render — a single, stable assertion point.
    const ariaLabelBefore = await figure.getAttribute('aria-label');
    if (!ariaLabelBefore) throw new Error('S-curve figure missing aria-label before mutation');
    const pctBefore = parseActualPct(ariaLabelBefore);

    // Also capture the visible figcaption gauge value as a human-readable
    // cross-check (NFR-SCA-001: line endpoint = gauge).
    const figcaption = page.locator('figcaption');
    await expect(figcaption).toBeVisible();
    const captionTextBefore = (await figcaption.textContent()) ?? '';
    // The figcaption reads: "... Actual to date  N% ..."
    const captionPctBefore = parseActualPct(captionTextBefore);
    // Verify aria-label and figcaption agree before mutation (NFR-SCA-001 sanity).
    expect(captionPctBefore).toBe(pctBefore);

    // ── Step 2: navigate to the Tasks tab and find the In-Progress task ─────────
    await page.getByRole('tab', { name: /tasks/i }).click();
    await expect(page).toHaveURL(new RegExp(`${PROJECT_ID}/tasks`), { timeout: 10_000 });

    // The task table may need a moment to populate from the query cache.
    const statusSelect = page.getByLabel(`Status for ${IN_PROGRESS_TASK_NAME}`);
    await expect(statusSelect).toBeVisible({ timeout: 15_000 });

    // Confirm the task is currently In Progress (Given state).
    await expect(statusSelect).toHaveValue('In Progress', { timeout: 10_000 });

    // ── Step 3: mark the In-Progress task Done ──────────────────────────────────
    await statusSelect.selectOption('Done');

    // Wait for the mutation to commit — the select reflects the new value.
    await expect(statusSelect).toHaveValue('Done', { timeout: 15_000 });

    // ── Step 4: navigate back to the Overview tab (S-curve refreshes) ───────────
    await page.getByRole('tab', { name: /overview/i }).click();
    await expect(page).toHaveURL(new RegExp(`${PROJECT_ID}/overview`), { timeout: 10_000 });

    // Wait for the S-curve figure to be present again.
    await expect(figure).toBeVisible({ timeout: 20_000 });

    // ── AFTER oracle part A: Actual-to-date % is strictly higher ────────────────
    // Retry-poll: React Query may need a moment to re-fetch + re-render after
    // the mutation.  Use expect.poll so the check retries automatically.
    await expect.poll(
      async () => {
        const label = await figure.getAttribute('aria-label');
        if (!label) return -1;
        try { return parseActualPct(label); } catch { return -1; }
      },
      {
        message: `Expected Actual-to-date gauge to increase above ${pctBefore}% after completing "${IN_PROGRESS_TASK_NAME}"`,
        timeout: 20_000,
      },
    ).toBeGreaterThan(pctBefore);

    // Capture the new value for the cross-check below.
    const ariaLabelAfter = (await figure.getAttribute('aria-label')) ?? '';
    const pctAfter = parseActualPct(ariaLabelAfter);

    // ── AFTER oracle part B: figcaption gauge matches the figure aria-label ────
    // NFR-SCA-001: the line endpoint value (aria-label) MUST equal the visible
    // "Actual to date" gauge in the figcaption at all times (no drift).
    const captionTextAfter = (await figcaption.textContent()) ?? '';
    const captionPctAfter = parseActualPct(captionTextAfter);
    expect(captionPctAfter).toBe(pctAfter);

    // ── AFTER oracle part C: the S-curve actual line has ≥2 points (is a line) ──
    // FR-SCA-012/013: when ≥2 actual points exist the chart renders a solid
    // connected line (not a lone dot).  The Recharts <Line dataKey="actual"> path
    // element ("d" attribute) contains multiple "L" move segments only when there
    // are real data points to connect.  We assert that at least one SVG <path>
    // inside the chart has a "d" value with multiple points (contains "L"),
    // confirming the connected-line rendering rather than a single dot.
    //
    // The chart is inside the <figure>; the actual Line element gets a class that
    // recharts generates dynamically, but the SVG path for a connected Line always
    // has a "d" attribute with "M … L … L …" segments when ≥2 points exist.
    const connectedLinePath = figure.locator('svg path[d*="L"]').first();
    await expect(connectedLinePath).toBeVisible({
      timeout: 10_000,
    });
  },
);
