// @e2e-isolation: read-only — layout measurements on a seeded route; no writes.
import { test } from '@playwright/test';
import { signIn } from '../helpers';
import { assertProjectsTableLayout } from '../support/layout-oracles';
import { registerLayoutSweep } from '../support/layout-sweep';

registerLayoutSweep({ path: '/projects', label: 'projects-list', icons: true, integrations: false });

test('@layout AC-TBL-OVERFLOW-001 AC-TBL-001 AC-TBL-RESIZE-001 AC-TBL-GEOM-001: Projects columns resize and remain in-scroller without page-level horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'admin@acme.test');
  await page.goto('/projects?view=table');
  await assertProjectsTableLayout(page);
});
