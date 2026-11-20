// @e2e-isolation: self-isolated — creates its own project, its own tasks and its own draft budget each run (and archives the project); the purchases legs only READ a seeded row (Copy link, no write).
import { test, expect, type Locator, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { pinEnglishLocale, requireServiceRoleKey, signIn, visibleToast, waitForFonts } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';
import type { Database } from '../src/lib/supabase/database.types';

/**
 * #2502 — a notice is painted over the page, never IN FRONT OF it.
 *
 * The bug: on a short window the bottom-right notice landed on the last visible table row's
 * control and held the pointer until the notice's clock expired, so a person could not keep
 * working. The rule now: the notice is pointer-transparent — every pixel except its own dismiss
 * button hit-tests through to whatever is underneath.
 *
 * The Done-when oracle, at 1280×720 and 390×844, for the task list, the purchases list and a
 * budget line: with the raised control at the bottom edge of the window (where the desktop notice
 * lands), every point of that control the notice's own button does not cover is STILL the topmost
 * element at that point (a real browser hit test, not a geometry guess) while the notice shows.
 */

const SEED_PROJECT_NAME = 'Innovate Corp HQ Fit-Out';

type Admin = SupabaseClient<Database>;

async function serviceClient(): Promise<Admin> {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('#2502 needs the local fixture service client');
  return createClient<Database>(requireMatchingLocalSupabaseUrls(undefined, undefined), key, {
    auth: { persistSession: false },
  });
}

/** Put the raised control at the bottom edge of the scrollport — "the last visible row". */
async function alignToViewportBottom(control: Locator) {
  await control.evaluate((el) => el.scrollIntoView({ block: 'end', inline: 'nearest' }));
}

interface HitProbe {
  x: number;
  y: number;
  reachable: boolean;
  blocker: string | null;
}

/** The notice is showing and the control still receives the pointer everywhere the notice cannot. */
async function expectControlReachableThroughNotice(
  page: Page,
  notice: Locator,
  control: Locator,
  { expectPaintOver }: { expectPaintOver: boolean },
) {
  await expect(notice).toBeVisible({ timeout: 15_000 });
  await expect(control).toBeVisible();
  const noticeBox = (await notice.boundingBox())!;
  const controlBox = (await control.boundingBox())!;
  expect(noticeBox, 'the notice is on screen').toBeTruthy();
  expect(controlBox, 'the control is on screen').toBeTruthy();
  const overlaps = noticeBox.x < controlBox.x + controlBox.width && controlBox.x < noticeBox.x + noticeBox.width
    && noticeBox.y < controlBox.y + controlBox.height && controlBox.y < noticeBox.y + noticeBox.height;
  if (expectPaintOver) {
    expect(overlaps, `the short window case: notice ${JSON.stringify(noticeBox)} painted over control ${JSON.stringify(controlBox)}`).toBe(true);
  }

  // 1. Every point of the control the notice's own dismiss button does not cover is the control —
  //    the person's click lands on the control, not on the notice. (The button is the one element
  //    a notice is allowed to keep: it must stay dismissible.)
  const dismissBox = await notice.getByRole('button', { name: 'Dismiss notification' }).boundingBox();
  const probes = await control.evaluate((el, avoid): HitProbe[] => {
    const rect = el.getBoundingClientRect();
    const points = [0.2, 0.5, 0.8].map((fraction) => ({
      x: rect.x + rect.width * fraction,
      y: rect.y + rect.height / 2,
    }));
    const covered = (p: { x: number; y: number }) => !!avoid
      && p.x >= avoid.x && p.x <= avoid.x + avoid.width && p.y >= avoid.y && p.y <= avoid.y + avoid.height;
    return points.filter((p) => !covered(p)).map((p) => {
      const top = document.elementFromPoint(p.x, p.y);
      return {
        ...p,
        reachable: top === el || el.contains(top),
        blocker: top === null ? 'nothing (off screen)' : top === el ? null : top.outerHTML.slice(0, 160),
      };
    });
  }, dismissBox);
  expect(probes.length, 'the control has at least one point clear of the notice\'s own button').toBeGreaterThan(0);
  for (const probe of probes) {
    expect(probe.reachable, `(${Math.round(probe.x)}, ${Math.round(probe.y)}) is taken by ${probe.blocker}`).toBe(true);
  }

  // 2. The notice's body is transparent: its own centre hit-tests to the page, not the notice.
  const bodyIsTransparent = await notice.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return top !== null && !el.contains(top);
  });
  expect(bodyIsTransparent, 'the notice body takes no pointer of its own').toBe(true);

  // 3. …while the one exception still works: its dismiss button is its own hit target.
  const dismiss = notice.getByRole('button', { name: 'Dismiss notification' });
  const dismissIsTop = await dismiss.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return top === el || el.contains(top);
  });
  expect(dismissIsTop, 'the dismiss button stays clickable').toBe(true);
}

async function createOwnProject(admin: Admin, label: string) {
  const pm = await admin.from('profiles').select('id, org_id').eq('email', 'pm@acme.test').single().throwOnError();
  const projectId = crypto.randomUUID();
  await admin.from('projects').insert({
    id: projectId, org_id: pm.data.org_id, name: `${label} ${Date.now()}`, status: 'Ongoing Project',
    currency: 'IDR', project_manager_id: pm.data.id,
  }).throwOnError();
  return { projectId, orgId: pm.data.org_id as string };
}

/** The project's area switcher: tabs at ≥768px (md), the labelled select below it. */
async function openTaskArea(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page.getByTestId('mobile-project-area-select').getByRole('combobox').selectOption('tasks');
  } else {
    await page.getByRole('tab', { name: /tasks/i }).click();
  }
  await expect(page.getByRole('tabpanel', { name: /tasks/i }).getByRole('tablist', { name: 'Task view', exact: true }))
    .toBeVisible({ timeout: 20_000 });
  await waitForFonts(page);
}

interface Viewport {
  label: string;
  width: number;
  height: number;
  /** On a phone the notice sits under the header, clear of the bottom row — no paint-over to prove. */
  expectPaintOver: boolean;
}

const VIEWPORTS: Viewport[] = [
  { label: '1280×720', width: 1280, height: 720, expectPaintOver: true },
  { label: '390×844', width: 390, height: 844, expectPaintOver: false },
];

for (const viewport of VIEWPORTS) {
  const { label, width, height, expectPaintOver } = viewport;

  test.describe(`#2502 notices never take the control they cover — ${label}`, () => {
    test.use({ viewport: { width, height } });

    test('the last visible task status control stays clickable while "Status updated" shows', async ({ page }) => {
      const admin = await serviceClient();
      const { projectId, orgId } = await createOwnProject(admin, 'Notice task list');
      const started = Date.now();
      await admin.from('tasks').insert(Array.from({ length: 16 }, (_, index) => ({
        org_id: orgId,
        project_id: projectId,
        name: `Notice row ${index + 1}`,
        status: 'To Do' as const,
        // Ascending created_at keeps the insertion order in the list (the list sorts by it).
        created_at: new Date(started + index).toISOString(),
      }))).throwOnError();

      try {
        await pinEnglishLocale(page);
        await signIn(page, 'pm@acme.test');
        await page.goto(`/projects/${projectId}`);
        await openTaskArea(page);

        const statusButton = page.getByRole('button', { name: /^Status for Notice row 16$/ });
        await alignToViewportBottom(statusButton);
        await statusButton.click();
        await page.getByLabel('Status for Notice row 16').selectOption('In Progress');

        // GOAL: the confirmation is up, and the row's control still receives the pointer — the
        // person's next click lands on the control, not on the notice.
        await expectControlReachableThroughNotice(page, visibleToast(page, 'Status updated'), statusButton, { expectPaintOver });
        await statusButton.click();
        await expect(page.getByLabel('Status for Notice row 16')).toBeVisible({ timeout: 10_000 });
        await page.keyboard.press('Escape');
      } finally {
        await admin.from('projects').update({ archived_at: new Date().toISOString() }).eq('id', projectId).throwOnError();
      }
    });

    test('the purchases list last row controls stay clickable while a notice shows', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
      await pinEnglishLocale(page);
      await signIn(page, 'pm@acme.test');
      await page.goto('/projects');
      await page.getByTestId('projects-table-container').getByRole('button', { name: SEED_PROJECT_NAME, exact: true }).click();
      await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/i, { timeout: 15_000 });
      await waitForFonts(page);

      const base = new URL(page.url()).pathname.replace(/\/$/, '');
      await page.goto(`${base}/procurement`);
      await page.waitForLoadState('networkidle');
      await waitForFonts(page);

      const lastActions = page.getByRole('button', { name: 'Row actions' }).last();
      await alignToViewportBottom(lastActions);
      await lastActions.click();
      await page.getByRole('menuitem', { name: 'Copy link' }).click();

      await expectControlReachableThroughNotice(page, visibleToast(page, /link cop|copy link/i), lastActions, { expectPaintOver });
      // The row menu still opens on the next click — the notice did not eat it.
      await lastActions.click();
      await expect(page.getByRole('menuitem', { name: 'Copy link' })).toBeVisible({ timeout: 10_000 });
      await page.keyboard.press('Escape');
    });

    test('a budget line control stays clickable while "Line item updated" shows', async ({ page }) => {
      const admin = await serviceClient();
      const { projectId, orgId } = await createOwnProject(admin, 'Notice budget');
      // An active budget plus a draft with 14 lines: the last line is where the person works.
      const active = await admin.from('budget_versions').insert({
        org_id: orgId, project_id: projectId, name: 'Notice active', version: 1, status: 'Draft', currency: 'IDR',
      }).select('id').single().throwOnError();
      await admin.from('budget_line_items').insert({
        org_id: orgId, budget_version_id: active.data.id, category: 'Labor', description: 'Approved labor', budgeted_amount: 1000,
      }).throwOnError();
      await admin.from('budget_versions').update({ status: 'Active' }).eq('id', active.data.id).throwOnError();
      const draft = await admin.from('budget_versions').insert({
        org_id: orgId, project_id: projectId, name: 'Notice draft', version: 2, status: 'Draft', currency: 'IDR',
      }).select('id').single().throwOnError();
      await admin.from('budget_line_items').insert(Array.from({ length: 14 }, (_, index) => ({
        org_id: orgId, budget_version_id: draft.data.id, category: 'Materials' as const,
        description: `Budget line ${index + 1}`, budgeted_amount: 100 + index,
      }))).throwOnError();

      try {
        await pinEnglishLocale(page);
        await signIn(page, 'pm@acme.test');
        await page.goto(`/projects/${projectId}/budget`);
        await page.getByRole('button', { name: 'Edit draft' }).click();
        const editor = page.getByTestId('budget-draft-editor');
        await expect(editor).toBeVisible({ timeout: 20_000 });
        await waitForFonts(page);

        const editButton = editor.getByRole('button', { name: 'Edit line item Materials' }).last();
        await alignToViewportBottom(editButton);
        await editButton.click();
        await editor.getByLabel('Amount').fill('250');
        await editor.getByRole('button', { name: 'Save', exact: true }).click();

        // GOAL: the line is still the person's to use while the confirmation covers it.
        await expectControlReachableThroughNotice(page, visibleToast(page, 'Line item updated'), editButton, { expectPaintOver });
        await editButton.click();
        await expect(editor.getByLabel('Amount')).toBeVisible({ timeout: 10_000 });
      } finally {
        await admin.from('projects').update({ archived_at: new Date().toISOString() }).eq('id', projectId).throwOnError();
      }
    });
  });
}
