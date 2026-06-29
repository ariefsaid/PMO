/**
 * AC-AS-022 — AI compose → populate builder → save.
 *
 * Curated E2E journey (ADR-0010, ADR-0039 §CI-test-isolation):
 *   - The Supabase Edge Function is intercepted via page.route — NO live Anthropic call.
 *   - The mocked spec passes compileCompositionSpec (DataTable + KPITile on 'projects',
 *     no requiredFilter entity, version: 1).
 *   - Flags required: VITE_FEATURES_USERVIEWS=true, VITE_FEATURES_AI_COMPOSER=true.
 *
 * Journey:
 *   1. Authenticate as admin@acme.test.
 *   2. Navigate to /views (My Views list).
 *   3. Click "Compose with AI".
 *   4. Enter prompt text and click "Generate".
 *   5. Assert modal closes and ViewBuilderPage opens with both panels in PanelList.
 *   6. Assert "AI-composed draft" indicator is visible (NFR-AS-A11Y-004).
 *   7. Fill in a view name and press Save.
 *   8. Assert the view persists (toast + navigation to /views/:id).
 *
 * Runs in: CI `integration` job (PR→main). NOT run locally (no local Supabase in the
 * lightweight verify lane).
 */
import { test, expect } from '@playwright/test';
import type { CompositionSpec } from '../src/lib/viewspec/types';
import { signIn } from './helpers';

test.setTimeout(120_000);

/**
 * Two-panel CompositionSpec that passes compileCompositionSpec.
 *
 * Panel 1 — DataTable of projects filtered by status (status is in allowedColumns,
 *            no requiredFilter on 'projects').
 * Panel 2 — KPITile summing contract_value on projects (numeric column, valid aggregate).
 *
 * Both panels use 'projects' which has no requiredFilter, so the compiler does not throw.
 * The spec is validated server-side (mocked to pass) and client-side (the hook calls
 * compileCompositionSpec in a try/catch — AC-AS-019).
 */
const MOCK_TWO_PANEL_SPEC: CompositionSpec = {
  version: 1,
  panels: [
    {
      id: 'panel-1',
      primitive: 'DataTable',
      querySpec: {
        entity: 'projects',
        select: ['id', 'name', 'status'],
        filters: [{ column: 'status', op: 'in', value: ['at-risk', 'delayed'] }],
      },
      layout: { colSpan: 2 },
      props: {},
    },
    {
      id: 'panel-2',
      primitive: 'KPITile',
      querySpec: {
        entity: 'projects',
        select: ['contract_value'],
        aggregate: { fn: 'sum', column: 'contract_value', alias: 'total_contract_value' },
      },
      props: {
        icon: 'currency',
        tone: 'green',
        label: 'Contract Value (This Quarter)',
      },
    },
  ],
};

test.describe('AC-AS-022: AI compose → populate builder → save', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept the compose-view edge function before any navigation.
    // Returns the pre-validated MOCK_TWO_PANEL_SPEC so no live Anthropic call is made.
    await page.route('**/functions/v1/compose-view', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          spec: MOCK_TWO_PANEL_SPEC,
          repairAttempts: 0,
        }),
      });
    });
  });

  test('AC-AS-022 AI compose → populate builder → save', async ({ page }) => {
    // ── 1. Authenticate ───────────────────────────────────────────────────────
    await signIn(page, 'admin@acme.test');

    // ── 2. Navigate to My Views ───────────────────────────────────────────────
    await page.goto('/views');
    await expect(page).toHaveURL('/views');

    // ── 3. Click "Compose with AI" on the My Views list ──────────────────────
    // The button is gated on FEATURES.userViews && FEATURES.aiComposer.
    // In CI integration job, both env vars are set to 'true'.
    const composeButton = page.getByRole('button', { name: /compose with ai/i });
    await expect(composeButton).toBeVisible({ timeout: 10_000 });
    await composeButton.click();

    // ── 4. AIComposerModal opens ───────────────────────────────────────────────
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    // The modal should have role=dialog with aria-modal (NFR-AS-A11Y-001, AC-AS-013)
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    // The textarea is labelled "Describe the view you want"
    const textarea = page.getByLabel(/describe the view you want/i);
    await expect(textarea).toBeVisible({ timeout: 5_000 });

    // ── 5. Enter the prompt and submit ────────────────────────────────────────
    await textarea.fill('show me at-risk projects and this quarter\'s contract value');
    await page.getByRole('button', { name: /generate/i }).click();

    // ── 6. Modal closes; ViewBuilderPage opens with both panels in PanelList ──
    // The modal dismisses when composition succeeds (onComposed navigates to /views/new)
    await expect(dialog).not.toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/views\/new/, { timeout: 15_000 });

    // Both panels should appear in the PanelList (AC-AS-014)
    // Each panel renders with the panel's primitive name visible
    await expect(page.getByText('DataTable')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('KPITile')).toBeVisible({ timeout: 10_000 });

    // ── 7. "AI-composed draft" indicator is visible (AC-AS-015, NFR-AS-A11Y-004) ──
    await expect(page.getByText(/ai-composed draft/i)).toBeVisible({ timeout: 5_000 });

    // ── 8. Fill a view name and press Save ────────────────────────────────────
    await page.getByRole('textbox', { name: /view name/i }).fill('At-Risk Projects & Contract Value');
    await page.getByRole('button', { name: /save/i }).click();

    // ── 9. Assert the view persists (toast + navigation to /views/:id) ────────
    // After save, the app navigates to /views/:newViewId
    await expect(page).toHaveURL(/\/views\/[^/]+$/, { timeout: 30_000 });

    // The draft indicator disappears after successful save (AC-AS-016)
    await expect(page.getByText(/ai-composed draft/i)).not.toBeVisible();
  });
});
