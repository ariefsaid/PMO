// @e2e-isolation: self-isolated — creates a unique local client, project, issued work order, its checklist rows and an approved document; deletes only rows linked to this run in finally. It writes the checklist rows directly (never the organisation's list), so no other spec's work orders gain a checklist.
// AC-WCO-012 — a work order issued with a close-out checklist: Finance attaches an eligible document to each required item and
// marks it done on the record page, then closes the work order from the project's list. Goal oracle: the close is refused
// while a required item is open, and once both are done the record shows Closed with the person who closed it.
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireServiceRoleKey, signIn } from './helpers';
import { orgToday } from './support/jobJourney';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';
import { openRowUpdate, openWorkOrderArea } from './support/workOrderArea';

test.setTimeout(120_000);

test('AC-WCO-012 required close-out items are done with documents, then the work order closes and records the closer', async ({ page }) => {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('AC-WCO-012 requires the local fixture service client');
  const admin: SupabaseClient = createClient(requireMatchingLocalSupabaseUrls(undefined, undefined), serviceKey, { auth: { persistSession: false } });
  const suffix = 'WCO-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const number = 'WO-' + suffix;
  let companyId = '';
  let projectId = '';
  let workOrderId = '';
  let documentId = '';
  let failure: unknown;
  const cleanupFailures: string[] = [];
  const cleanup = async (label: string, op: () => PromiseLike<{ error: { message: string } | null }>) => {
    try { const r = await op(); if (r.error) cleanupFailures.push(label + ': ' + r.error.message); }
    catch (e) { cleanupFailures.push(label + ': ' + (e instanceof Error ? e.message : String(e))); }
  };

  try {
    const profile = await admin.from('profiles').select('id,org_id,full_name').eq('email', 'finance@acme.test').single();
    if (profile.error) throw new Error('AC-WCO-012 fixture profile: ' + profile.error.message);
    const orgId = profile.data.org_id;
    const company = await admin.from('companies').insert({ org_id: orgId, name: 'Client ' + suffix, type: 'Client' }).select('id').single();
    if (company.error) throw new Error('AC-WCO-012 fixture client: ' + company.error.message);
    companyId = company.data.id;
    const project = await admin.from('projects').insert({
      org_id: orgId, name: 'Closeout project ' + suffix, status: 'Ongoing Project', currency: 'EUR', client_id: companyId,
      contract_value: 1_000_000, tax_treatment: 'exclusive', tax_amount: 0, subject_to_vat: false, tax_rate: null,
      tax_base_numerator: 1, tax_base_denominator: 1,
    }).select('id').single();
    if (project.error) throw new Error('AC-WCO-012 fixture project: ' + project.error.message);
    projectId = project.data.id;
    workOrderId = crypto.randomUUID();
    const wo = await admin.from('work_orders').insert({
      id: workOrderId, org_id: orgId, project_id: projectId, title: 'Closeout journey ' + suffix, status: 'Issued', wo_number: number,
      issued_at: new Date().toISOString(), order_value: 500_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'EUR',
    });
    if (wo.error) throw new Error('AC-WCO-012 fixture work order: ' + wo.error.message);
    const today = orgToday();
    const items = await admin.from('work_order_closeout_items').insert([
      { org_id: orgId, work_order_id: workOrderId, project_id: projectId, position: 1, name: 'Item one ' + suffix, required: true, started_on: today },
      { org_id: orgId, work_order_id: workOrderId, project_id: projectId, position: 2, name: 'Item two ' + suffix, required: true },
      { org_id: orgId, work_order_id: workOrderId, project_id: projectId, position: 3, name: 'Item three ' + suffix, required: false },
    ]);
    if (items.error) throw new Error('AC-WCO-012 fixture items: ' + items.error.message);
    documentId = crypto.randomUUID();
    const doc = await admin.from('project_documents').insert({
      id: documentId, org_id: orgId, project_id: projectId, category: 'Acceptance', title: 'Evidence ' + suffix, status: 'Approved',
      author_id: profile.data.id, file_path: orgId + '/' + projectId + '/' + documentId + '/evidence.pdf',
    });
    if (doc.error) throw new Error('AC-WCO-012 fixture document: ' + doc.error.message);

    await signIn(page, 'finance@acme.test');
    await page.route('**/api/resource/**', (route) => route.abort());

    // The record shows the checklist with the two required items open.
    await page.goto('/work-orders/' + workOrderId);
    await openWorkOrderArea(page, 'checks');
    await expect(page.getByTestId('closeout-summary')).toContainText('Required items not done: 2');

    // A document is needed before an item can be marked done; the first item is current.
    await openRowUpdate(page, 'Item one ' + suffix);
    await expect(page.getByRole('button', { name: 'Mark Item one ' + suffix + ' done' })).toBeDisabled();
    await page.getByRole('combobox', { name: 'Project documents' }).selectOption({ label: 'Evidence ' + suffix });
    await page.getByRole('button', { name: 'Attach to Item one ' + suffix }).click();
    await page.getByRole('button', { name: 'Mark Item one ' + suffix + ' done' }).click();
    await expect(page.getByTestId('closeout-summary')).toContainText('Required items not done: 1');

    // The second item cannot be marked done before it has a document either; then it can.
    await openRowUpdate(page, 'Item two ' + suffix);
    await page.getByRole('combobox', { name: 'Project documents' }).selectOption({ label: 'Evidence ' + suffix });
    await page.getByRole('button', { name: 'Attach to Item two ' + suffix }).click();

    // Closing while the second required item is open is refused by the database, with the count.
    await page.goto('/projects/' + projectId + '/contract');
    await page.getByRole('button', { name: 'Actions for ' + number }).click();
    await page.getByRole('menuitem', { name: 'Close order' }).click();
    await page.getByRole('button', { name: 'Close work order' }).click();
    await expect(page.getByText('this work order cannot close: 1 required close-out item(s) are not done', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    // Mark it done, close again, and the record names who closed it.
    await page.goto('/work-orders/' + workOrderId);
    await openWorkOrderArea(page, 'checks');
    await openRowUpdate(page, 'Item two ' + suffix);
    await page.getByRole('button', { name: 'Mark Item two ' + suffix + ' done' }).click();
    await expect(page.getByTestId('closeout-summary')).toContainText('Every required item is done');
    await page.goto('/projects/' + projectId + '/contract');
    await page.getByRole('button', { name: 'Actions for ' + number }).click();
    await page.getByRole('menuitem', { name: 'Close order' }).click();
    await page.getByRole('button', { name: 'Close work order' }).click();
    await page.goto('/work-orders/' + workOrderId);
    await openWorkOrderArea(page, 'checks');
    await expect(page.getByTestId('closeout-summary')).toContainText('by ' + profile.data.full_name);
    await expect(page.getByTestId('record-header')).toContainText('Closed');
  } catch (e) {
    failure = e;
  } finally {
    if (workOrderId) await cleanup('delete work order', () => admin.from('work_orders').delete().eq('id', workOrderId));
    if (documentId) await cleanup('delete document', () => admin.from('project_documents').delete().eq('id', documentId));
    if (projectId) await cleanup('delete project', () => admin.from('projects').delete().eq('id', projectId));
    if (companyId) await cleanup('delete client', () => admin.from('companies').delete().eq('id', companyId));
  }
  if (cleanupFailures.length > 0) {
    const ce = new Error('AC-WCO-012 cleanup failed: ' + cleanupFailures.join('; '));
    if (failure) throw new AggregateError([failure, ce], 'AC-WCO-012 failed and cleanup reported errors');
    throw ce;
  }
  if (failure) throw failure;
});
