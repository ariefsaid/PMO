// @e2e-isolation: serial — replaces the organisation's material-request approval chain for the run (an org-global singleton) and puts it back in finally.
// JOB-WAIT-3 / JOB-WAIT-4 / JOB-WAIT-5 (the person who made a request): it says who it waits for; when it is returned they are told with the reason;
// and when they open it again the over-plan reason they typed is there beside the reason it came back.
// JOB-WAIT-3 also reads the seeded prior-week Submitted timesheet as its requester (read-only) to prove the same sentence names the actual eligible actor/role.
import { test, expect } from '@playwright/test';
import { signIn } from '../helpers';
import { userClient } from '../support/stockFixture';
import { submittedOverPlanRequest, type WaitingFixture } from '../support/waitingFixture';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
test.setTimeout(240_000);

test('JOB-WAIT-3/4/5 a request names who it waits for, a return tells the requester why, and editing it keeps what was typed', async ({ page }) => {
  let fx: WaitingFixture | null = null;
  try {
    fx = await submittedOverPlanRequest('JOBWAIT3', 'Project Manager', 'engineer@acme.test');

    // JOB-WAIT-3: the requester sees who it waits for and at which step, not a bare "waiting".
    await signIn(page, 'engineer@acme.test');
    await page.goto(`/material-requests/${fx.requestId}`);
    await expect(page.getByTestId('mrq-waiting-for')).toContainText(/Waiting for Site check · Project Manager/);

    // The Project Manager returns it with a reason (through the same function the screen calls).
    const pm = await userClient('pm@acme.test');
    const decided = await pm.rpc('mrq_decide_step', { p_request_id: fx.requestId, p_step_position: 1, p_decision: 'return', p_reason: 'Split the pour over two days' });
    expect(decided.error).toBeNull();

    // JOB-WAIT-4: the requester is told, with the reason and which request it was.
    await page.goto('/');
    await page.getByRole('button', { name: /notifications/i }).click();
    const bell = page.getByRole('list', { name: 'Notifications' });
    await expect(bell.getByText('Your material request was sent back')).toBeVisible({ timeout: 20_000 });
    await expect(bell.getByText('Split the pour over two days')).toBeVisible();
    await expect(bell.getByTestId('notification-entity-label').first()).toContainText(fx.requestNumber);

    // JOB-WAIT-5: editing the returned request shows why it came back, and keeps the over-plan reason typed before.
    await page.goto(`/material-requests/${fx.requestId}/edit`);
    await expect(page.getByTestId('mrq-returned-reason')).toContainText('Split the pour over two days');
    await expect(page.getByLabel(/why do you need more than the plan/i)).toHaveValue('Extra pour on the east slab');

    // JOB-WAIT-3 (timesheet requester): the same seeded requester opens their own prior-week Submitted
    // week and sees the actual eligible line manager and role from the server-computed route. Read-only:
    // the seed row (70000000-…0004) is never mutated here; its week is read through the requester's own RLS.
    const PRIOR_WEEK_SHEET_ID = '70000000-0000-0000-0000-000000000004';
    const engineer = await userClient('engineer@acme.test');
    const { data: submitted, error: submittedError } = await engineer
      .from('timesheets')
      .select('week_start_date, status')
      .eq('id', PRIOR_WEEK_SHEET_ID)
      .maybeSingle();
    if (submittedError || !submitted || submitted.status !== 'Submitted') {
      throw new Error(`JOB-WAIT-3 timesheet seed missing or not Submitted: ${submittedError?.message ?? submitted?.status ?? 'no row'}`);
    }
    await page.goto(`/timesheets?week=${submitted.week_start_date}`);
    await expect(page.getByTestId('timesheet-waiting-for'))
      .toHaveText('Waiting for Diego Salvatierra, line manager or Admin', { timeout: 20_000 });
  } finally {
    if (fx) await fx.restore();
  }
});
