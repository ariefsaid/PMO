// @e2e-isolation: self-isolated — creates a unique client, project, two work orders and one purchase; deletes only rows linked to this run in finally.
// AC-WPL-012 — a purchase for two work orders: each line says which work order it is for. Goal oracle: lines that all name one work order
// give the request that work order; once a line is changed to the other work order the request keeps what it had (lines that differ
// leave the header alone), and each line shows its own work order. Written for the orchestrator's browser run, not run by the builder.
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { login, pinEnglishLocale, requireServiceRoleKey } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

test.setTimeout(120_000);

test('AC-WPL-012 each purchase line names its work order; all-the-same is copied to the request, different leaves it', async ({ page }) => {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('AC-WPL-012 requires the local fixture service client');
  const admin: SupabaseClient = createClient(requireMatchingLocalSupabaseUrls(undefined, undefined), serviceKey, { auth: { persistSession: false } });
  const suffix = 'WPL-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const ids = { company: '', project: '', wo1: crypto.randomUUID(), wo2: crypto.randomUUID(), procurement: '' };
  let failure: unknown;
  const cleanupFailures: string[] = [];
  const cleanup = async (label: string, op: () => PromiseLike<{ error: { message: string } | null }>) => {
    try { const r = await op(); if (r.error) cleanupFailures.push(label + ': ' + r.error.message); }
    catch (e) { cleanupFailures.push(label + ': ' + (e instanceof Error ? e.message : String(e))); }
  };
  const header = async () => {
    const r = await admin.from('procurements').select('work_order_id').eq('id', ids.procurement).single();
    if (r.error) throw new Error('AC-WPL-012 read header: ' + r.error.message);
    return r.data.work_order_id as string | null;
  };

  try {
    const profile = await admin.from('profiles').select('org_id').eq('email', 'admin@acme.test').single();
    if (profile.error) throw new Error('AC-WPL-012 fixture profile: ' + profile.error.message);
    const orgId = profile.data.org_id;
    const company = await admin.from('companies').insert({ org_id: orgId, name: 'Client ' + suffix, type: 'Client' }).select('id').single();
    if (company.error) throw new Error('AC-WPL-012 fixture client: ' + company.error.message);
    ids.company = company.data.id;
    const project = await admin.from('projects').insert({
      org_id: orgId, name: 'Lines project ' + suffix, status: 'Ongoing Project', currency: 'EUR', client_id: ids.company,
      contract_value: 1_000_000, tax_treatment: 'exclusive', tax_amount: 0, subject_to_vat: false, tax_rate: null,
      tax_base_numerator: 1, tax_base_denominator: 1,
    }).select('id').single();
    if (project.error) throw new Error('AC-WPL-012 fixture project: ' + project.error.message);
    ids.project = project.data.id;
    const orders = await admin.from('work_orders').insert([ids.wo1, ids.wo2].map((id, i) => ({
      id, org_id: orgId, project_id: ids.project, title: 'Order ' + (i + 1) + ' ' + suffix, client_po_number: 'PO' + (i + 1) + '-' + suffix, status: 'Issued',
      wo_number: 'WO' + (i + 1) + '-' + suffix, issued_at: new Date().toISOString(), order_value: 500_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'EUR',
    })));
    if (orders.error) throw new Error('AC-WPL-012 fixture work orders: ' + orders.error.message);

    await pinEnglishLocale(page);
    await login(page, 'admin@acme.test');
    await page.goto('/procurement/new?project=' + ids.project + '&have=need');
    await page.getByLabel(/title/i).first().fill('Lines purchase ' + suffix);
    const addRow = page.getByTestId('line-items-section').getByRole('row').filter({ hasText: 'New line' });
    for (const [name, rate] of [['Line one ' + suffix, '600'], ['Line two ' + suffix, '400']]) {
      await addRow.getByLabel(/new item description/i).fill(name);
      await addRow.getByLabel(/new item quantity/i).fill('1');
      await addRow.getByLabel(/new item unit price/i).fill(rate);
      await addRow.getByRole('button', { name: /add line item/i }).click();
    }
    const section = page.getByTestId('line-work-orders-section');
    await expect(section).toBeVisible({ timeout: 15_000 });
    for (const line of ['Line one ' + suffix, 'Line two ' + suffix]) {
      await section.getByRole('combobox', { name: 'Work order for ' + line }).selectOption({ label: 'WO1-' + suffix });
    }
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: 'Lines purchase ' + suffix })).toBeVisible({ timeout: 20_000 });
    ids.procurement = page.url().split('/procurement/')[1].split(/[/?#]/)[0];

    // GOAL: every line names WO-1, so the request takes WO-1.
    const lines = await admin.from('procurement_items').select('name, work_order_id').eq('procurement_id', ids.procurement).order('name');
    if (lines.error) throw new Error('AC-WPL-012 read lines: ' + lines.error.message);
    expect(lines.data?.map((l) => l.work_order_id)).toEqual([ids.wo1, ids.wo1]);
    await expect.poll(header).toBe(ids.wo1);

    // Change line two to WO-2 on the Items tab: the lines now differ, and the request keeps WO-1.
    await page.getByRole('tab', { name: /Line items/i }).click();
    const panel = page.getByTestId('line-plan-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await panel.getByRole('combobox', { name: 'Work order for Line two ' + suffix }).selectOption({ label: 'WO2-' + suffix });
    await panel.getByRole('button', { name: 'Save' }).click();
    await expect(panel.getByText('Saved')).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByTestId('line-work-order-differs').first()).toBeVisible();
    const after = await admin.from('procurement_items').select('name, work_order_id').eq('procurement_id', ids.procurement).order('name');
    if (after.error) throw new Error('AC-WPL-012 read lines after: ' + after.error.message);
    expect(after.data?.map((l) => l.work_order_id)).toEqual([ids.wo1, ids.wo2]);
    expect(await header()).toBe(ids.wo1);
  } catch (e) {
    failure = e;
  } finally {
    if (ids.procurement) {
      await cleanup('delete request records', () => admin.from('purchase_requests').delete().eq('procurement_id', ids.procurement));
      await cleanup('delete lines', () => admin.from('procurement_items').delete().eq('procurement_id', ids.procurement));
      await cleanup('delete purchase', () => admin.from('procurements').delete().eq('id', ids.procurement));
    }
    await cleanup('delete work orders', () => admin.from('work_orders').delete().in('id', [ids.wo1, ids.wo2]));
    if (ids.project) await cleanup('delete project', () => admin.from('projects').delete().eq('id', ids.project));
    if (ids.company) await cleanup('delete client', () => admin.from('companies').delete().eq('id', ids.company));
  }
  if (cleanupFailures.length > 0) {
    const ce = new Error('AC-WPL-012 cleanup failed: ' + cleanupFailures.join('; '));
    if (failure) throw new AggregateError([failure, ce], 'AC-WPL-012 failed and cleanup reported errors');
    throw ce;
  }
  if (failure) throw failure;
});
