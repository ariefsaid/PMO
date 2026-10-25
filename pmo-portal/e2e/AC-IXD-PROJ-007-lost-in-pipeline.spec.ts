// @e2e-isolation: read-only — login + pipeline/projects nav assertions on seeded Loss Tender; no DB writes.
import { test, expect, type Page } from '@playwright/test';
import { login, openPipelineCard } from './helpers';

/**
 * AC-IXD-PROJ-007 (Model B, ADR-0020): a Loss Tender (lost) deal is sales history, not delivery
 * work. It appears in the PIPELINE's named Lost scope on Board and Table, and is ABSENT from the
 * active Projects list.
 *
 * Seed (seed.sql): P004 "Coastal Depot Bid" = Loss Tender. pm/exec own it.
 */

test.setTimeout(120_000);

async function waitProjectsReady(page: Page) {
  await expect(page.getByTestId('projects-loading')).not.toBeVisible({ timeout: 20_000 });
}

function projectRow(page: Page, name: string) {
  return page.locator('table tbody tr').filter({ has: page.getByRole('button', { name, exact: true }) });
}

const LOST_DEAL = 'Coastal Depot Bid';

test(
  'AC-IXD-PROJ-007: a Loss Tender deal is reachable in the Pipeline Lost kanban column and behind the Lost table filter, and is absent from the active Projects list',
  async ({ page }) => {
    await login(page, 'exec@acme.test');

    // ── It is ABSENT from the active Projects (delivery) list ────────────────
    await page.goto('/projects');
    await waitProjectsReady(page);
    await expect(projectRow(page, LOST_DEAL)).toHaveCount(0);

    // ── It is reachable in the Pipeline's Lost scope and terminal group ─────────
    await page.goto('/sales');
    const board = page.getByLabel('Sales pipeline board');
    await expect(board).toBeVisible({ timeout: 15_000 });
    await page.getByRole('combobox', { name: 'Project scope' }).selectOption('Lost');
    await expect(page).toHaveURL(/[?&]scope=Lost/);
    const lostColumn = page.getByTestId('stage-Lost');
    await expect(lostColumn).toBeVisible();
    // the lost deal card is inside the Lost column and fully reachable (not clipped):
    // scroll it into view and confirm it can be clicked to open its detail page.
    const lostCard = lostColumn.getByText(LOST_DEAL).first();
    await lostCard.scrollIntoViewIfNeeded();
    await expect(lostCard).toBeVisible();
    // openPipelineCard retries the click until /projects/:id is reached (the card click→navigate
    // can be swallowed if fired pre-hydration under parallel-suite load).
    await openPipelineCard(page, LOST_DEAL, lostColumn);
    await expect(page.getByRole('heading', { name: LOST_DEAL })).toBeVisible({ timeout: 15_000 });

    // ── It is reachable in Table under the same Lost scope ───────────────────
    await page.goto('/sales?view=table&scope=Lost');
    await page.getByRole('tab', { name: /^Table$/i }).click();
    await expect(page.getByRole('combobox', { name: 'Project scope' })).toHaveValue('Lost');
    await expect(page.getByText(LOST_DEAL).first()).toBeVisible({ timeout: 15_000 });
  },
);
