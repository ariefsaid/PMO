import { test, expect } from '@playwright/test';
import { login } from './helpers';

// AC-PK-005 — the read-only Projects Kanban journey: a real session opens the Projects → Kanban
// view, the lifecycle-status columns render, and clicking a project card navigates to that
// project's detail route. Goal-oracle: "kanban board renders AND a project card navigates to its
// detail route" — never downgraded to "a Kanban button exists".
test('AC-PK-005: Projects kanban view renders status columns and a card click navigates to detail', async ({
  page,
}) => {
  await login(page, 'pm@acme.test');
  await page.goto('/projects');

  // Switch to the Board (kanban) view — the toggle is labelled "Board" after the terminology pass.
  await page.getByRole('tab', { name: /board/i }).click();

  // The board root must appear.
  const board = page.getByTestId('project-kanban-board');
  await expect(board).toBeVisible();

  // At least one of the five lifecycle columns must be visible.
  const ongoingCol = board.getByTestId('kanban-col-ongoing');
  await expect(ongoingCol).toBeVisible();

  // A seeded project card exists in the board; clicking the first card navigates to detail.
  // We find the first KanbanCard (role=button, excluding the KanbanStageIndicator buttons which
  // have aria-label matching the stage name). Project cards have the project name as aria-label.
  const firstCard = board.locator('[role="button"]').filter({ hasText: /\w/ }).first();
  await firstCard.click();

  // AC-PK-005: activating a kanban card navigates to that project's detail route.
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/);
});
