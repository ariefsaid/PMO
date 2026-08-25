// @e2e-isolation: read-only — signIn + render the seeded /meetings list + the seeded detail (editor + share popover) + axe. No DB writes.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signIn } from './helpers';

// AC-MTG-023: the meeting routes pass axe-core (WCAG-AA). Joins AC-PR-026's pattern per the spec's
// traceability table — same builder, same tag set, meeting surfaces.
//
// ⚑ I2 (spec review 2026-08-24): the gates must see a POPULATED page — an axe pass over an empty
// list certifies a shell, not the module. supabase/seed.sql §V seeds two meetings AUTHORED BY
// pm@acme.test precisely so this signed-in user's attendance-keyed read model (0205/DD-MTG-7)
// does not blank the surface. The detail run covers the author's minutes EDITOR, the attendee
// list, and the share panel with its member combobox POPOVER OPEN (the portal-rendered listbox
// is exactly the kind of surface an closed-state-only pass never sees).

/** §V seed: "Meridian PV — weekly site coordination", authored by pm@, 4 minute blocks, 2 attendees. */
const SEEDED_MEETING = 'ee000000-0000-0000-0000-000000000001';

test('AC-MTG-023: the POPULATED /meetings list passes axe-core (WCAG-AA)', async ({ page }) => {
  await signIn(page, 'pm@acme.test');
  await page.goto('/meetings');
  await expect(page.getByRole('heading', { name: /meetings/i }).first()).toBeVisible();
  // Populated, not a shell: the seeded row must be on screen before the scan means anything.
  await expect(page.getByText('Meridian PV — weekly site coordination')).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('AC-MTG-023: the seeded /meetings/:id detail — editor + share popover open — passes axe-core (WCAG-AA)', async ({
  page,
}) => {
  await signIn(page, 'pm@acme.test'); // the seeded author: sees the minutes EDITOR, not read-only
  await page.goto(`/meetings/${SEEDED_MEETING}`);
  await expect(
    page.getByRole('heading', { name: 'Meridian PV — weekly site coordination' }),
  ).toBeVisible();
  // The author surface is fully rendered: editor lines + attendees + the share panel.
  await expect(page.getByTestId('minutes-editor')).toBeVisible();
  await expect(page.getByTestId('attendees-list')).toBeVisible();

  // Scan 1: the resting detail page.
  const resting = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(resting.violations).toEqual([]);

  // Scan 2: with the share panel's member combobox OPEN — the portal-rendered listbox state.
  await page.getByRole('combobox', { name: /Share with a named person/i }).click();
  await expect(page.getByRole('listbox')).toBeVisible();
  const popoverOpen = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(popoverOpen.violations).toEqual([]);
});
