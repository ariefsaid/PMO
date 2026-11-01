// @e2e-isolation: self-isolated — creates its own uniquely named deal via service role and deletes it; no shared seed row is moved.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createClient } from '@supabase/supabase-js';
import { signIn, requireServiceRoleKey, visibleToast } from './helpers';
import { dragCardTo } from './support/boardDrag';

// AC-DND-014 / AC-DND-016 (#1637): drag-and-drop on the Sales Pipeline board, real browser, real DB.
//
// Journey: an Exec opens /sales with a self-created deal in Quotation. Dragging it back to Leads is
// refused (no write, message shown); dragging it to Tender asks the status menu's confirm and, once
// confirmed, survives a reload in Tender; dragging it to Won asks for the contract details and, once
// submitted, survives a reload in Won. axe runs on the idle board, mid-drag and with the confirm open.
//
// ISOLATION: unique deal per run, deleted (history first) in afterEach even on failure.

test.setTimeout(180_000);
test.use({ viewport: { width: 2200, height: 1100 } }); // all seven columns visible: 7 × 258 px + gaps + rail

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';

const svcKey = requireServiceRoleKey();
if (!svcKey) {
  throw new Error('AC-DND-014: SUPABASE_SERVICE_ROLE_KEY is required for this owning journey (local fixture dependency) - it must not silently skip.');
}
const admin = createClient(SUPABASE_URL, svcKey, { auth: { persistSession: false } });

let PROJECT_ID: string;
let DEAL: string;
let RUN_ID: string;

test.beforeEach(async () => {
  RUN_ID = crypto.randomUUID().slice(0, 8);
  PROJECT_ID = crypto.randomUUID();
  DEAL = `DND 1637 ${RUN_ID}`;
  // contract_value 0 → the win-eligibility preflight answers 'allowed' for any write role (0394).
  const { error } = await admin.from('projects').insert({
    id: PROJECT_ID, org_id: ORG_ID, name: DEAL, status: 'Quotation Submitted',
    currency: 'USD', contract_value: 0, tax_treatment: 'exclusive', tax_amount: 0,
  });
  if (error) throw new Error(`AC-DND-014 seed deal failed: ${error.message}`);
});

test.afterEach(async () => {
  await admin.from('record_changes').delete().eq('entity_id', PROJECT_ID);
  await admin.from('projects').delete().eq('id', PROJECT_ID);
});

test('AC-DND-014 Exec drags a deal: illegal drop refused, Quotation→Tender confirmed, Tender→Won with contract details persist', async ({ page }) => {
  await signIn(page, 'exec@acme.test');
  await page.goto('/sales');
  const board = page.getByLabel('Sales pipeline board');
  const card = () => board.getByRole('button', { name: new RegExp(DEAL) }).first();
  await expect(card()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('stage-Quotation Submitted').getByText(DEAL)).toBeVisible();

  // AC-DND-016: the idle board passes axe.
  const idle = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(idle.violations).toEqual([]);

  // 1. Illegal move: refused, nothing written, the card stays in Quotation.
  const writes: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/rpc/transition_project')) writes.push(r.url()); });
  await dragCardTo(page, card(), page.getByTestId('stage-Leads'));
  await expect(visibleToast(page, `${DEAL} can't move from Quotation to Leads.`)).toBeVisible();
  await expect(page.getByTestId('stage-Quotation Submitted').getByText(DEAL)).toBeVisible();
  expect(writes).toHaveLength(0);

  // 2. Legal move: the status menu's confirm, then it persists.
  await dragCardTo(page, card(), page.getByTestId('stage-Tender Submitted'), async () => {
    // AC-DND-016: axe passes mid-drag. The card's own column carries no cue; a legal column says so; an illegal one says so.
    await expect(page.getByTestId('stage-Tender Submitted').getByText('Drop to move here')).toBeVisible();
    await expect(page.getByTestId('stage-Leads').getByText("Can't move here")).toBeVisible();
    await expect(page.getByTestId('stage-Quotation Submitted').getByText("Can't move here")).toHaveCount(0);
    await expect(page.getByTestId('stage-Quotation Submitted').getByText('Drop to move here')).toHaveCount(0);
    const midDrag = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(midDrag.violations).toEqual([]);
  });
  await expect(page.getByText('Move project to Tender Submitted?')).toBeVisible();
  const confirmOpen = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(confirmOpen.violations).toEqual([]);
  const moved = page.waitForResponse((r) => r.url().includes('/rpc/transition_project'));
  await page.getByRole('button', { name: 'Move to Tender Submitted' }).click();
  expect((await moved).ok()).toBe(true);
  await page.reload();
  await expect(page.getByTestId('stage-Tender Submitted').getByText(DEAL)).toBeVisible({ timeout: 20_000 });

  // 3. Win: the contract details form, then it persists in Won.
  await dragCardTo(page, card(), page.getByTestId('stage-Won'));
  await page.getByLabel('Customer contract ref').fill(`CPO-${RUN_ID}`);
  await page.getByLabel('Contract date').fill('2026-11-01');
  const won = page.waitForResponse((r) => r.url().includes('/rpc/transition_project'));
  await page.getByRole('button', { name: /^confirm$/i }).click();
  expect((await won).ok()).toBe(true);
  await page.reload();
  await expect(page.getByTestId('stage-Won').getByText(DEAL)).toBeVisible({ timeout: 20_000 });
});
