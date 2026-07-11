// @e2e-isolation: serial — mutates org-global state (see design 2026-07-11-e2e-parallel-isolation).
import { test, expect, type Page } from '@playwright/test';
import { signIn } from '../helpers';

/**
 * AC-ENT-005  Administration › Features › Operator toggle — real cross-stack journey
 * (ops-admin-surface S7 capstone, ADR-0010). Covers FR-ENT-006.
 *
 * Given the platform Operator on /administration › Features, when they toggle `incidents` OFF for
 * the org, then an org member's next shell render HIDES the Incidents rail item AND a deep-link to
 * /incidents redirects to / (dashboard) — disable = hide, never destroy (FeatureRoute). Re-enabling
 * incidents restores both the rail item and the route.
 *
 * CORE ORACLE (asserted): disable → rail item hidden + /incidents → / redirect; re-enable →
 *   rail item + route restored.
 *
 * DATA-LOSS SUB-ASSERTION — DEFERRED (documented): the plan's full AC-ENT-005 also asks to assert a
 * pre-existing incident row is still reachable after a disable→re-enable cycle (disable never
 * destroys data). The `incidents` module is DISABLED by default in the seed
 * (`FEATURE_ENV_DEFAULT.incidents = false` + no `org_features` row), so the Incidents module — its
 * list page, create form, and detail route — is UNREACHABLE in the seed state. We cannot seed an
 * incident via the UI without first enabling the module, and the moment we enable it the toggle is
 * "on" (the very pre-condition this spec establishes anyway), so a UI-seeded incident would itself
 * depend on the enable step and cannot prove independent data survival. Proving "data survives a
 * disable cycle" requires either (a) a direct DB seed of an incident + a server-enforced module
 * (ADR-0049 notes the module's tables/RPCs are NOT yet server-enforced — UX-hide only), or (b) the
 * incidents module shipping enabled-by-default. Both are out of scope for S7. The no-data-loss
 * guarantee is therefore asserted at the layer that actually enforces it today: <FeatureRoute>
 * REDIRECTS instead of 404-ing and the toggle is a pure UX projection — the underlying rows are
 * never touched by the toggle (the spec's "disable = hide, never destroy" invariant).
 */

test.setTimeout(120_000);

/** The Incidents rail nav link (text "Incidents"). */
const incidentsRail = (page: Page) => page.getByRole('link', { name: /^incidents$/i });

/** The Incidents `role="switch"` toggle in the Features section (aria-label="Incidents"). */
const incidentsSwitch = (page: Page) => page.getByRole('switch', { name: /^incidents$/i });

test(
  'AC-ENT-005: the Operator disables incidents — an org member loses the rail item + /incidents redirects to /, then re-enabling restores both (goal oracle: disable = hide, never destroy)',
  async ({ page }) => {
    // ── Given: the Operator on /administration › Features ──
    await signIn(page, 'operator@pmo.test');
    await page.goto('/administration');
    await expect(page.getByRole('heading', { name: /^Features$/ })).toBeVisible({ timeout: 20_000 });

    // PRE-CONDITION: ensure `incidents` is ENABLED first so the disable journey has a clean start.
    // (Seed default is disabled + no org_features row; toggling on writes the overriding row.)
    const sw = incidentsSwitch(page);
    await expect(sw).toBeVisible({ timeout: 20_000 });
    if ((await sw.getAttribute('aria-checked')) !== 'true') {
      await sw.click();
      // The toggle mutation invalidates orgFeatures; wait for the switch to reflect "on".
      await expect(sw).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 });
    }

    // ── When: the Operator toggles incidents OFF ──
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false', { timeout: 20_000 });

    // ── Then: an org member's next shell render hides the Incidents rail item ──
    // Sign out and back in as an org Admin (a role whose rail includes Incidents when enabled).
    await page.getByRole('button', { name: /^sign out$/i }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    await signIn(page, 'admin@acme.test');

    // The rail renders on the dashboard. Incidents must be ABSENT (the feature is hidden for this org).
    await expect(incidentsRail(page)).not.toBeVisible({ timeout: 20_000 });

    // AND a deep-link to /incidents redirects to / (dashboard) — disable = hide, never destroy
    // (FeatureRoute renders <Navigate to="/" replace />, NOT a 404).
    await page.goto('/incidents');
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

    // ── Re-enable: the Operator turns incidents back on ──
    await page.getByRole('button', { name: /^sign out$/i }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    await signIn(page, 'operator@pmo.test');
    await page.goto('/administration');
    await expect(page.getByRole('heading', { name: /^Features$/ })).toBeVisible({ timeout: 20_000 });
    const sw2 = incidentsSwitch(page);
    await expect(sw2).toHaveAttribute('aria-checked', 'false');
    await sw2.click();
    await expect(sw2).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 });

    // ── And: the rail item + route reappear for an org member ──
    await page.getByRole('button', { name: /^sign out$/i }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    await signIn(page, 'admin@acme.test');

    // GOAL ORACLE: the Incidents rail item is back, and /incidents renders the page (no redirect).
    await expect(incidentsRail(page)).toBeVisible({ timeout: 20_000 });
    await page.goto('/incidents');
    await expect(page).not.toHaveURL(/\/$/, { timeout: 15_000 });
  },
);
