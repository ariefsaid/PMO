// @e2e-isolation: serial — changes the organisation-wide attendance target and restores it in finally.
import { test, expect } from '@playwright/test';
import { signIn, visibleToast } from '../helpers';
import { ORG_ID, need, serviceClient } from '../support/jobFixtures';

test.setTimeout(90_000);

test('AC-ATR-011 an Admin saves valid decimal attendance targets and reads them back', async ({ page }) => {
  const svc = serviceClient('AC-ATR-011');
  const previous = need('read target', await svc.from('organizations')
    .select('attendance_target_rate').eq('id', ORG_ID).single()).attendance_target_rate;
  try {
    need('clear target', await svc.from('organizations').update({ attendance_target_rate: null })
      .eq('id', ORG_ID).select('id').single());
    await signIn(page, 'admin@acme.test');
    await page.goto('/administration/projects');
    const card = page.getByRole('region', { name: 'Attendance target', exact: true });
    const field = card.getByLabel('Target rate (%)');
    for (const value of ['80.1', '0.29', '92.25']) {
      await field.fill(value);
      await card.getByRole('button', { name: 'Save target', exact: true }).click();
      await expect(visibleToast(page, 'Attendance target saved')).toBeVisible();
      await expect(card.getByRole('button', { name: 'Save target', exact: true })).toBeDisabled();
      const saved = need('saved target', await svc.from('organizations')
        .select('attendance_target_rate').eq('id', ORG_ID).single());
      expect(Number(saved.attendance_target_rate)).toBe(Number(value));
      await page.reload();
      await expect(field).toHaveValue(value);
    }
    for (const [value, message] of [
      ['92.255', 'Give the target at most two decimals.'],
      ['100.01', 'The target runs from 0 to 100.'],
    ]) {
      await field.fill(value);
      await card.getByRole('button', { name: 'Save target', exact: true }).click();
      await expect(card.getByText(message, { exact: true })).toBeVisible();
      const saved = need('unchanged target', await svc.from('organizations')
        .select('attendance_target_rate').eq('id', ORG_ID).single());
      expect(Number(saved.attendance_target_rate)).toBe(92.25);
    }
  } finally {
    need('restore target', await svc.from('organizations').update({ attendance_target_rate: previous })
      .eq('id', ORG_ID).select('id').single());
  }
});
