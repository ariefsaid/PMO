// @e2e-isolation: serial — replaces the organisation's material-request approval chain for the run (an org-global singleton) and puts it back in finally.
// JOB-WAIT-2 (Finance): the home, the Finance page and the approvals inbox answer "what waits for me" with the same list and the same number.
import { test, expect } from '@playwright/test';
import { signIn } from '../helpers';
import { submittedOverPlanRequest, type WaitingFixture } from '../support/waitingFixture';

test.setTimeout(180_000);

test('JOB-WAIT-2 Finance sees the same waiting request on the home, the Finance page and the inbox, with one count', async ({ page }) => {
  let fx: WaitingFixture | null = null;
  try {
    fx = await submittedOverPlanRequest('JOBWAIT2', 'Finance', 'engineer@acme.test');
    await signIn(page, 'finance@acme.test');

    // Finance page: the waiting card lists the request and carries the count.
    await page.goto('/finance');
    const card = page.getByTestId('finance-hub-waiting');
    await expect(card.getByText(/Waiting for your decision \(\d+\)/)).toBeVisible({ timeout: 20_000 });
    await expect(card.getByRole('link', { name: /Material request, step 1: Site check/ }).first()).toBeVisible();
    const count = Number((await card.getByText(/Waiting for your decision \(\d+\)/).textContent())?.match(/\((\d+)\)/)?.[1]);

    // Home: the approvals line says the same number.
    await page.goto('/');
    await expect(page.getByRole('link', { name: new RegExp(`^${count}\\s*approvals? waiting for you`, 'i') }).first()).toBeVisible({ timeout: 20_000 });

    // Inbox: "All pending" is that number and the request is listed.
    await page.goto('/approvals');
    await expect(page.getByRole('tab', { name: /All pending/i })).toContainText(String(count));
    await expect(page.getByText(fx.requestNumber)).toBeVisible();
  } finally {
    if (fx) await fx.restore();
  }
});
