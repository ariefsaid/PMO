import { expect, type Page } from '@playwright/test';

export const SEED_PASSWORD = 'Passw0rd!dev';

/** Sign in via the /login form and wait for the dashboard. */
export async function signIn(page: Page, email: string, password = SEED_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** Alias for signIn — used by data-layer e2e specs (AC-4xx). */
export const login = signIn;
