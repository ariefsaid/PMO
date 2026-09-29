// @e2e-isolation: read-only — signs in the seed Admin and runs axe-core over nine settled RIS-Admin surfaces in light and dark themes; the only interceptions are an org_features read fixture and a mocked personal Microsoft 365 status call. No DB writes.
import { test, expect, type Page, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signIn, grantM365EntitlementFixture, stubM365StatusUnavailable } from './helpers';

/**
 * AC-RAM-004 (#688) — the RIS Admin setup-to-first-project surfaces pass axe-core WCAG 2 A/AA in BOTH
 * themes. Owns matrix cells O8 (accessible names) and O10 (light/dark contrast) for R1–R8
 * (docs/specs/ris-admin-route-matrix.spec.md). jsdom cannot compute contrast, so this is the lowest
 * sufficient layer. Same builder + tag set as AC-PR-026 / AC-MTG-023.
 *
 * Every scan waits for a POPULATED surface first — an axe pass over a skeleton certifies a shell.
 * Code proof on the seed-org sample Admin only; it says nothing about live RIS connections.
 */

const ADMIN = 'admin@acme.test';
/** P011 "Highfield Bridge Survey" — a pre-win seed row (pipeline lens), read only. */
const PIPELINE_LENS = '40000000-0000-0000-0000-000000000011';
/** SP-2401 "Meridian Steelworks 4.2 MW Rooftop PV" — an on-hand seed row (delivery lens), read only. */
const DELIVERY_LENS = '41000000-0000-0000-0000-000000000001';

interface Surface {
  label: string;
  path: string;
  ready: (page: Page) => Locator;
  prepare?: (page: Page) => Promise<void>;
}

const SURFACES: Surface[] = [
  { label: 'administration-users', path: '/administration/users', ready: (p) => p.getByRole('searchbox', { name: 'Search users' }) },
  {
    label: 'administration-integrations',
    path: '/administration/integrations',
    ready: (p) => p.getByRole('heading', { level: 2, name: 'Organization integrations' }),
  },
  { label: 'administration-accounting', path: '/administration/accounting', ready: (p) => p.locator('#budget-account-map') },
  { label: 'administration-credits', path: '/administration/credits', ready: (p) => p.getByTestId('org-credit-balance') },
  {
    label: 'personal-integrations',
    path: '/integrations',
    prepare: async (p) => {
      await grantM365EntitlementFixture(p);
      await stubM365StatusUnavailable(p);
    },
    ready: (p) => p.getByTestId('m365-unknown-msg'),
  },
  { label: 'projects', path: '/projects', ready: (p) => p.getByText('Meridian Steelworks 4.2 MW Rooftop PV').first() },
  { label: 'sales', path: '/sales', ready: (p) => p.getByText('Highfield Bridge Survey').first() },
  { label: 'project-pipeline-lens', path: `/projects/${PIPELINE_LENS}`, ready: (p) => p.getByLabel('Project stage journey') },
  {
    label: 'project-delivery-lens',
    path: `/projects/${DELIVERY_LENS}/overview`,
    ready: (p) => p.getByRole('heading', { name: /Meridian Steelworks 4\.2 MW Rooftop PV/ }),
  },
];

for (const theme of ['light', 'dark'] as const) {
  for (const s of SURFACES) {
    test(`AC-RAM-004 ${s.label} @${theme} passes axe-core (WCAG-AA)`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await signIn(page, ADMIN);
      await s.prepare?.(page);
      // index.html reads the `theme` key before first paint (same mechanism as AC-ADMIA-005).
      await page.evaluate((t) => localStorage.setItem('theme', t), theme);
      await page.goto(s.path);
      if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
      else await expect(page.locator('html')).not.toHaveClass(/dark/);

      await expect(s.ready(page)).toBeVisible({ timeout: 20_000 });
      await page.waitForLoadState('networkidle').catch(() => {});

      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(
        results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
        `axe WCAG-AA violations on ${s.path} (${theme})`,
      ).toEqual([]);
    });
  }
}