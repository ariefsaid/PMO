// @e2e-isolation: serial — replaces the organisation's material-request approval chain for the run (an org-global singleton) and puts it back in finally.
// JOB-WAIT-1 (step-1 approver of a material request): what waits for me is on my home, in my menu with a count, and in the approvals inbox, and they are the same number.
import { test, expect } from '@playwright/test';
import { signIn } from '../helpers';
import { submittedOverPlanRequest, type WaitingFixture } from '../support/waitingFixture';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
test.setTimeout(180_000);

test('JOB-WAIT-1 an Engineer who approves the first step finds the request on their home, in the menu with a count, and in the inbox', async ({ page }) => {
  let fx: WaitingFixture | null = null;
  try {
    // The Project Manager raises it; the first step belongs to the Engineer role (the requester is never offered their own).
    fx = await submittedOverPlanRequest('JOBWAIT1', 'Engineer', 'pm@acme.test');
    await signIn(page, 'engineer@acme.test');

    // Home: the waiting card names the step and links the request.
    const card = page.getByTestId('eng-waiting-for-you');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.locator(`a[href$="/material-requests/${fx.requestId}"]`)).toContainText('Material request, step 1: Site check');
    const headline = Number(((await card.getByRole('heading').first().textContent()) ?? '').match(/\((\d+)\)/)?.[1] ?? NaN);
    expect(headline).toBeGreaterThanOrEqual(1);

    // The phone menu has an Approvals entry (the Engineer role has none by default) and its badge is the same number.
    const entry = page.getByRole('navigation', { name: 'Phone navigation' }).getByRole('link', { name: /pending Approvals/ });
    await expect(entry).toBeVisible();
    await expect(entry).toContainText(`${headline} pending`);

    // The inbox lists the request, and its "All pending" count is that number.
    await entry.click();
    await expect(page.getByText(fx.requestNumber)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Material requests awaiting you' })).toBeVisible();
  } finally {
    if (fx) await fx.restore();
  }
});
