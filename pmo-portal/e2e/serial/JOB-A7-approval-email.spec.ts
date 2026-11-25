// @e2e-isolation: serial — turns the organisation-wide approval-email event on and restores its prior value in afterEach; the request itself is scoped to a project this run owns.
/**
 * JOB-A7 / TC-PA-14 — an approver is told outside the app about a request waiting for them.
 *
 * The admin switches approval emails on (Administration → Organization integrations → Email notifications).
 * A purchase request routed to the approver then arrives on their in-app notification list, and the app queues the
 * approval email addressed to that person, which the background sender delivers to their mailbox. The mailbox itself
 * is outside the browser (the local stack has no mail sender configured), so the journey's last leg asserts the queued
 * email's recipient and reason — the app-side facts the case's "they receive an email" depends on.
 */
import { test, expect } from '@playwright/test';
import { serviceClient, ownProject, dropProject, uniq, ORG_ID, need, ok, runId } from '../support/jobFixtures';
import { roleJobUser } from '../support/roleJobUser';
import { signIn } from '../helpers';

test.setTimeout(180_000);

const admin = serviceClient('JOB-A7');
let projectId = '';
let priorEmailSetting: { enabled: boolean; extra_roles: string[] } | null = null;
const people: Awaited<ReturnType<typeof roleJobUser>>[] = [];

test.afterEach(async () => {
  if (projectId) {
    await admin.from('procurements').delete().eq('project_id', projectId);
    await admin.from('spend_approvers').delete().eq('project_id', projectId);
    await admin.from('budget_line_items').delete().in('budget_version_id',
      ((await admin.from('budget_versions').select('id').eq('project_id', projectId)).data ?? []).map((v) => v.id));
    await admin.from('budget_versions').delete().eq('project_id', projectId);
    await dropProject(admin, projectId);
  }
  for (const person of people.splice(0)) {
    await admin.from('notifications').delete().eq('owner_id', person.id);
    await person.cleanup();
  }
  if (priorEmailSetting === null) await admin.from('email_event_settings').delete().eq('org_id', ORG_ID).eq('event_key', 'approval_request');
  else await admin.from('email_event_settings').upsert({ org_id: ORG_ID, event_key: 'approval_request', enabled: priorEmailSetting.enabled, extra_roles: priorEmailSetting.extra_roles });
  projectId = '';
  priorEmailSetting = null;
});

test('JOB-A7 an approver is told by email about a request waiting for approval', async ({ page }) => {
  const sfx = uniq();
  const { data: before } = await admin.from('email_event_settings').select('enabled, extra_roles').eq('org_id', ORG_ID).eq('event_key', 'approval_request').maybeSingle();
  priorEmailSetting = before ?? null;

  const administrator = await roleJobUser(admin, 'administrator', runId('a7-admin'));
  const approver = await roleJobUser(admin, 'project_manager', runId('a7-approver'));
  people.push(administrator, approver);

  // 1. The admin switches approval emails on.
  await administrator.signIn(page);
  await page.goto('/administration/integrations');
  const toggle = page.getByRole('switch', { name: 'Approval requests' });
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  if (!(await toggle.isChecked())) await toggle.click();
  await expect(toggle).toBeChecked();
  await expect.poll(async () => (await admin.from('email_event_settings').select('enabled').eq('org_id', ORG_ID).eq('event_key', 'approval_request').single()).data?.enabled).toBe(true);

  // 2. An admin sets up a request on a project this run owns, routed to the approver.
  projectId = await ownProject(admin, `JOB-A7 project ${sfx}`);
  const version = need('budget', await admin.from('budget_versions').insert({
    org_id: ORG_ID, project_id: projectId, name: `Budget ${sfx}`, version: 1, status: 'Draft',
  }).select('id').single());
  ok('budget line', await admin.from('budget_line_items').insert({ org_id: ORG_ID, budget_version_id: version.id, category: 'Materials', budgeted_amount: 1_000_000 }));
  ok('activate', await admin.from('budget_versions').update({ status: 'Active' }).eq('id', version.id));
  ok('approver', await admin.from('spend_approvers').insert({ org_id: ORG_ID, project_id: projectId, profile_id: approver.id }));

  // 3. The requester writes the purchase request and sends it for approval on screen: it routes to the approver.
  await signIn(page, 'pm@acme.test');
  await page.goto(`/procurement/new?have=need&project=${projectId}&title=${encodeURIComponent(`Valve set ${sfx}`)}&lineName=Valve&lineQty=1&lineRate=25000`);
  await page.getByRole('combobox', { name: 'Budget category' }).selectOption({ label: 'Materials' });
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page).toHaveURL(/\/procurement\/[0-9a-f-]{36}/, { timeout: 20_000 });
  await page.getByRole('button', { name: 'Submit for approval' }).first().click();
  const confirm = page.getByRole('dialog').getByRole('button', { name: /submit for approval/i });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Requested', { timeout: 20_000 });

  // The request is waiting for the approver in the app, and the app queued the approval email addressed to that person.
  await expect.poll(async () => {
    const { data } = await admin.from('email_outbox').select('event_key, recipient_id, status').eq('org_id', ORG_ID).eq('recipient_id', approver.id);
    return data ?? [];
  }, { timeout: 20_000 }).toContainEqual(expect.objectContaining({ event_key: 'approval_request', recipient_id: approver.id }));

  // ...and the queued email is addressed to that approver.
  const { data: inbox } = await admin.from('email_outbox').select('event_key, recipient_id').eq('recipient_id', approver.id);
  expect(inbox).toEqual([{ event_key: 'approval_request', recipient_id: approver.id }]);
  const { data: approverProfile } = await admin.from('profiles').select('email').eq('id', approver.id).single();
  expect(approverProfile?.email).toContain('@example.test');

  // The approver signs in and sees the request waiting for their decision (the in-app side of the same event).
  await approver.signIn(page);
  const bell = page.getByRole('button', { name: /notifications, \d+ unread/i });
  await expect(bell).toBeVisible({ timeout: 20_000 });
  await bell.click();
  await expect(page.getByRole('list', { name: /notifications/i }).getByText('Procurement awaiting your approval')).toBeVisible({ timeout: 10_000 });
});
