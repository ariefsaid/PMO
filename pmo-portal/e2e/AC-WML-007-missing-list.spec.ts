// @e2e-isolation: self-isolated — creates a unique local client, project, issued work order, its billing step rows and an approved document; deletes only rows linked to this run in finally. It writes the step rows directly (never the organisation's default template), so no other spec's work orders gain a list.
// AC-WML-007 — the work order page lists what it still lacks and Export downloads it. Goal oracle: an open billing step and its
// required attachment not yet attached appear with who adds them; the CSV holds the same rows; once the attachment is added and the
// step finished, that step's rows leave the list.
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireServiceRoleKey, signIn } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';
import { openRowUpdate, openWorkOrderArea } from './support/workOrderArea';

test.setTimeout(120_000);

test('AC-WML-007 open steps and a missing attachment are listed, exported, and leave the list when done', async ({ page }) => {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('AC-WML-007 requires the local fixture service client');
  const admin: SupabaseClient = createClient(requireMatchingLocalSupabaseUrls(undefined, undefined), serviceKey, { auth: { persistSession: false } });
  const suffix = 'WML-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
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
    const profile = await admin.from('profiles').select('id,org_id').eq('email', 'finance@acme.test').single();
    if (profile.error) throw new Error('AC-WML-007 fixture profile: ' + profile.error.message);
    const orgId = profile.data.org_id;
    const company = await admin.from('companies').insert({ org_id: orgId, name: 'Client ' + suffix, type: 'Client' }).select('id').single();
    if (company.error) throw new Error('AC-WML-007 fixture client: ' + company.error.message);
    companyId = company.data.id;
    const project = await admin.from('projects').insert({
      org_id: orgId, name: 'Steps project ' + suffix, status: 'Ongoing Project', currency: 'EUR', client_id: companyId,
      contract_value: 1_000_000, tax_treatment: 'exclusive', tax_amount: 0, subject_to_vat: false, tax_rate: null,
      tax_base_numerator: 1, tax_base_denominator: 1,
    }).select('id').single();
    if (project.error) throw new Error('AC-WML-007 fixture project: ' + project.error.message);
    projectId = project.data.id;
    workOrderId = crypto.randomUUID();
    const wo = await admin.from('work_orders').insert({
      id: workOrderId, org_id: orgId, project_id: projectId, title: 'Steps journey ' + suffix, status: 'Issued', wo_number: 'WO-' + suffix,
      issued_at: new Date().toISOString(), order_value: 500_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'EUR',
    });
    if (wo.error) throw new Error('AC-WML-007 fixture work order: ' + wo.error.message);
    const today = new Date().toISOString().slice(0, 10);
    const steps = await admin.from('work_order_billing_steps').insert([
      { org_id: orgId, work_order_id: workOrderId, project_id: projectId, position: 1, name: 'First ' + suffix, owner_role_key: 'billing_officer', target_days: 5, started_on: today },
      { org_id: orgId, work_order_id: workOrderId, project_id: projectId, position: 2, name: 'Second ' + suffix, owner_role_key: 'finance_officer' },
    ]).select('id,position');
    if (steps.error) throw new Error('AC-WML-007 fixture steps: ' + steps.error.message);
    const first = steps.data.find((s) => s.position === 1)?.id;
    const slot = await admin.from('work_order_billing_step_documents').insert({ org_id: orgId, step_id: first, work_order_id: workOrderId, position: 1, name: 'Evidence slot ' + suffix, required: true });
    if (slot.error) throw new Error('AC-WML-007 fixture slot: ' + slot.error.message);
    documentId = crypto.randomUUID();
    const doc = await admin.from('project_documents').insert({
      id: documentId, org_id: orgId, project_id: projectId, category: 'Acceptance', title: 'Evidence ' + suffix, status: 'Approved',
      author_id: profile.data.id, file_path: orgId + '/' + projectId + '/' + documentId + '/evidence.pdf',
    });
    if (doc.error) throw new Error('AC-WML-007 fixture document: ' + doc.error.message);

    await signIn(page, 'finance@acme.test');
    await page.route('**/api/resource/**', (route) => route.abort());

    await page.goto('/work-orders/' + workOrderId);
    await openWorkOrderArea(page, 'checks');
    const list = page.getByTestId('missing-list');
    await expect(list).toContainText('First ' + suffix);
    await expect(list).toContainText('Second ' + suffix);
    await expect(list).toContainText('Evidence slot ' + suffix);
    await expect(page.getByTestId('missing-step-attachment')).toContainText('Who adds it:');

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^Missing_\d{4}-\d{2}-\d{2}\.csv$/);
    let csv = '';
    for await (const chunk of await download.createReadStream()) csv += chunk.toString();
    expect(csv).toContain('First ' + suffix);
    expect(csv).toContain('Evidence slot ' + suffix);

    // Attach the document and finish the first step: its step row and attachment row leave the list; the second step stays.
    await openWorkOrderArea(page, 'billing');
    await openRowUpdate(page, 'First ' + suffix);
    await page.getByRole('combobox', { name: 'Document for Evidence slot ' + suffix }).selectOption({ label: 'Evidence ' + suffix });
    await page.getByRole('button', { name: 'Attach to Evidence slot ' + suffix }).click();
    await page.getByRole('button', { name: 'Mark First ' + suffix + ' done' }).click();
    await openWorkOrderArea(page, 'checks');
    await expect(list).not.toContainText('First ' + suffix);
    await expect(list).not.toContainText('Evidence slot ' + suffix);
    await expect(list).toContainText('Second ' + suffix);
  } catch (e) {
    failure = e;
  } finally {
    if (workOrderId) await cleanup('delete work order', () => admin.from('work_orders').delete().eq('id', workOrderId));
    if (documentId) await cleanup('delete document', () => admin.from('project_documents').delete().eq('id', documentId));
    if (projectId) await cleanup('delete project', () => admin.from('projects').delete().eq('id', projectId));
    if (companyId) await cleanup('delete client', () => admin.from('companies').delete().eq('id', companyId));
  }
  if (cleanupFailures.length > 0) {
    const ce = new Error('AC-WML-007 cleanup failed: ' + cleanupFailures.join('; '));
    if (failure) throw new AggregateError([failure, ce], 'AC-WML-007 failed and cleanup reported errors');
    throw ce;
  }
  if (failure) throw failure;
});
