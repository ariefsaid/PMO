// @e2e-isolation: self-isolated — unique issue type (Date.now()); the overdue job is run through a test-only SQL call against the local DB; feature-flagged skip.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { login } from './helpers';

/**
 * AC-SIL-014  Raised → assigned → late → escalated → closed with proof (docs/specs/site-issue-log.spec.md).
 * The overdue job is invoked by a SQL call, not a sleep: the issue's due time is moved into the past, then the job runs.
 *
 * QUARANTINE: feature flag incidents=false (src/lib/features.ts). Un-skip when the flag is on.
 */
test.setTimeout(180_000);

function sql(statement: string): string {
  return execFileSync('docker', ['exec', '-i', 'supabase_db_pmo-portal', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8' }).trim();
}

test.skip('AC-SIL-014: an issue is raised, assigned, goes late, is escalated, and closes with a close photo (QUARANTINE: incidents flag off)', async ({ page }) => {
  const type = `E2E-Lifecycle-${Date.now()}`;
  await login(page, 'pm@acme.test');
  await page.goto('/incidents');
  await page.getByRole('button', { name: /file incident/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^type/i).fill(type);
  await dialog.getByLabel(/severity/i).selectOption('High');
  await dialog.getByRole('button', { name: /^file incident$/i }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });

  // Late: the test hook moves the due time into the past, then runs the overdue job once.
  sql(`update incident_reports set due_at = now() - interval '1 hour' where type = '${type}';`);
  expect(sql('select public.escalate_overdue_incidents();')).toMatch(/^[1-9]\d*$/);

  await page.reload();
  await page.getByRole('button', { name: new RegExp(`open ${type}`, 'i') }).click();
  await expect(page.getByTestId('incident-escalated')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('incident-pills')).toContainText(/overdue/i);

  // Investigate, then close: a High issue needs a close photo.
  await page.getByTestId('incident-advance').click();
  await page.getByRole('dialog').getByRole('button', { name: /start investigating/i }).click();
  await expect(page.getByTestId('incident-pills')).toHaveAttribute('data-status', 'Investigating', { timeout: 20_000 });
  await page.getByTestId('incident-advance').click();
  const close = page.getByRole('dialog');
  await expect(close.getByRole('button', { name: /close incident/i })).toBeDisabled();
  const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
  await close.getByTestId('incident-close-photo-input').setInputFiles({ name: 'fixed.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await close.getByRole('button', { name: /close incident/i }).click();
  await expect(page.getByTestId('incident-pills')).toHaveAttribute('data-status', 'Closed', { timeout: 20_000 });

  expect(sql(`select (closed_at is not null)::text from incident_reports where type = '${type}';`)).toBe('true');
  expect(sql(`select count(*) from incident_files f join incident_reports i on i.id = f.incident_id where i.type = '${type}' and f.kind = 'at_close';`)).toBe('1');
});
