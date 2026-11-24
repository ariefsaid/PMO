import type { Page } from '@playwright/test';
import { SEED_PASSWORD } from '../helpers';
import { serviceClient, ORG_ID, ok } from './jobFixtures';

/** Own a login rather than changing a shared seed user's job role. */
export async function moneyJobRole(key: string, role = 'Engineer') {
  const admin = serviceClient('money role journey');
  const email = `money-${crypto.randomUUID()}@example.test`;
  const created = await admin.auth.admin.createUser({ email, password: SEED_PASSWORD, email_confirm: true });
  if (created.error || !created.data.user) throw new Error('Create journey login: ' + created.error?.message);
  const user = created.data.user;
  ok('profile', await admin.from('profiles').upsert({ id: user.id, org_id: ORG_ID, email, full_name: 'Journey worker', role, built_in_role: key, status: 'active' }));
  return {
    id: user.id,
    async login(page: Page) {
      await page.goto('/login');
      await page.getByLabel(/email/i).fill(email);
      await page.getByLabel(/password/i).fill(SEED_PASSWORD);
      await page.getByRole('button', { name: /sign in/i }).click();
      await page.waitForURL((url) => url.pathname !== '/login');
    },
    async cleanup() { ok('delete login', await admin.auth.admin.deleteUser(user.id)); },
  };
}
