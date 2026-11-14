// @e2e-isolation: self-isolated — each run creates its own uniquely named task on the seed project and deletes it at the end; nothing else is touched.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { login, pinEnglishLocale, waitForFonts } from './helpers';

/**
 * AC-GANTT-DRAG-001  Dragging a Gantt bar reschedules the task (#1980) — real pointer journey.
 *
 *   PM (can edit tasks): opens the Tasks Timeline, drags a bar 2 days right with the mouse,
 *   reloads, and the task carries the new dates. A read-only role (Finance, not the creator)
 *   presses and drags the same bar: it does not move and the dates are unchanged after reload.
 *
 * jsdom cannot lay out a gantt, so the pointer path is proven here (the unit tests cover the
 * commit logic only). Dates are fixed in the current month so the bar needs no scale change.
 */

test.setTimeout(180_000);

const PROJECT_ID = '40000000-0000-0000-0000-000000000001';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const now = new Date();
const monthDay = (day: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day));
const START = monthDay(10);
const END = monthDay(14);
const label = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const rangeText = (s: Date, e: Date) => new RegExp(`${label(s)}\\s*–\\s*${label(e)}`);

async function openTasks(page: Page) {
  await page.goto(`/projects/${PROJECT_ID}`);
  await page.getByRole('tab', { name: /tasks/i }).click();
  const panel = page.getByRole('tabpanel', { name: /tasks/i });
  await expect(panel.getByRole('tablist', { name: 'Task view', exact: true })).toBeVisible({ timeout: 20_000 });
  return panel;
}

async function openTimeline(page: Page) {
  const panel = await openTasks(page);
  await panel.getByRole('tab', { name: /timeline/i }).click();
  await expect(page.getByRole('figure')).toBeVisible({ timeout: 20_000 });
  await waitForFonts(page);
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  return panel;
}

function taskRow(panel: Locator, name: string) {
  return panel.locator('[data-slot="gantt-row-group"]').filter({ hasText: name });
}

async function dragBar(page: Page, name: string, days: number) {
  const bar = page.getByRole('button', { name: new RegExp(name) }).first();
  await bar.scrollIntoViewIfNeeded();
  const box = (await bar.boundingBox())!;
  // 5 inclusive days on the bar: one day's width, from the bar itself (scale-independent).
  const perDay = box.width / 5;
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + (perDay * days) / 2, y, { steps: 5 });
  await page.mouse.move(x + perDay * days, y, { steps: 5 });
  await page.mouse.up();
}

test('AC-GANTT-DRAG-001: PM drags a bar 2 days and the new dates persist; a read-only role cannot move it', async ({ page, browser }) => {
  const name = `E2E-Gantt-${Date.now()}`;
  await pinEnglishLocale(page);
  await login(page, 'pm@acme.test');

  // Seed the task through the real form (own row, unique name).
  await openTasks(page);
  await page.getByRole('button', { name: /new task/i }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/task name/i).fill(name);
  await dialog.getByLabel(/start date/i).fill(iso(START));
  await dialog.getByLabel(/due date/i).fill(iso(END));
  await dialog.getByRole('button', { name: /create task/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 15_000 });

  try {
    // ── PM drags +2 days ──
    let panel = await openTimeline(page);
    await expect(taskRow(panel, name).getByText(rangeText(START, END))).toBeVisible({ timeout: 15_000 });
    await dragBar(page, name, 2);

    const moved = [monthDay(12), monthDay(16)] as const;
    // GOAL ORACLE: after a reload the task carries the new dates.
    await page.reload();
    panel = await openTimeline(page);
    await expect(taskRow(panel, name).getByText(rangeText(moved[0], moved[1]))).toBeVisible({ timeout: 20_000 });

    // ── Read-only role: same drag, nothing saves ──
    const roCtx = await browser.newContext();
    const ro = await roCtx.newPage();
    await pinEnglishLocale(ro);
    await login(ro, 'finance@acme.test');
    const roPanel = await openTimeline(ro);
    await expect(taskRow(roPanel, name).getByText(rangeText(moved[0], moved[1]))).toBeVisible({ timeout: 20_000 });
    const writes: string[] = [];
    ro.on('request', (r) => {
      if (r.method() !== 'GET' && /\/rest\/v1\/tasks/.test(r.url())) writes.push(r.url());
    });
    await dragBar(ro, name, 2);
    await ro.reload();
    const roAfter = await openTimeline(ro);
    await expect(taskRow(roAfter, name).getByText(rangeText(moved[0], moved[1]))).toBeVisible({ timeout: 20_000 });
    expect(writes).toEqual([]);
    await roCtx.close();
  } finally {
    // Cleanup: delete the owned task.
    await openTasks(page);
    const row = page.locator('table tbody tr').filter({ has: page.getByRole('button', { name: `Open task ${name}`, exact: true }) });
    await row.getByRole('button', { name: 'Row actions' }).click();
    await page.getByRole('menuitem', { name: /delete/i }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: /delete task/i }).click();
    await expect(row).not.toBeVisible({ timeout: 15_000 });
  }
});
