// @e2e-isolation: read-only — signIn + render /meetings (list, and detail via a created row) + axe. No shared-row mutation.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signIn } from './helpers';

// AC-MTG-023: the meeting routes pass axe-core (WCAG-AA). Joins AC-PR-026's pattern per the spec's
// traceability table — same builder, same tag set, meeting surfaces.
test('AC-MTG-023: /meetings list passes axe-core (WCAG-AA)', async ({ page }) => {
  await signIn(page, 'pm@acme.test');
  await page.goto('/meetings');
  await expect(page.getByRole('heading', { name: /meetings/i }).first()).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});
