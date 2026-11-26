// @e2e-isolation: self-isolated — creates its own client, project, issued work order and an executed inspection (with its report object) and deletes only rows linked to this run in finally.
// AC-TPI-016 (#2580): on a phone, an Engineer attaches the report photo and sets the result, and the inspection shows Reported.
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireServiceRoleKey, signIn } from './helpers';
import { orgToday } from './support/jobJourney';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

test.setTimeout(120_000);
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

// 1x1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('AC-TPI-016 an Engineer attaches the report photo and sets the result on a phone', async ({ page }) => {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('AC-TPI-016 requires the local fixture service client');
  const admin: SupabaseClient = createClient(requireMatchingLocalSupabaseUrls(undefined, undefined), serviceKey, { auth: { persistSession: false } });
  const suffix = 'TPE-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const testName = 'Weld test ' + suffix;
  let companyId = '';
  let projectId = '';
  let workOrderId = '';
  let inspectionId = '';
  let failure: unknown;
  const cleanupFailures: string[] = [];
  const cleanup = async (label: string, op: () => PromiseLike<{ error: { message: string } | null }>) => {
    try { const r = await op(); if (r.error) cleanupFailures.push(label + ': ' + r.error.message); }
    catch (e) { cleanupFailures.push(label + ': ' + (e instanceof Error ? e.message : String(e))); }
  };

  try {
    const profile = await admin.from('profiles').select('id, org_id').eq('email', 'pm@acme.test').single();
    if (profile.error) throw new Error('AC-TPI-016 fixture profile: ' + profile.error.message);
    const orgId = profile.data.org_id;
    const company = await admin.from('companies').insert({ org_id: orgId, name: 'Client ' + suffix, type: 'Client' }).select('id').single();
    if (company.error) throw new Error('AC-TPI-016 fixture client: ' + company.error.message);
    companyId = company.data.id;
    const project = await admin.from('projects').insert({
      org_id: orgId, name: 'Inspection project ' + suffix, status: 'Ongoing Project', currency: 'USD', client_id: companyId,
      contract_value: 1_000_000, tax_treatment: 'exclusive', tax_amount: 0, subject_to_vat: false, tax_rate: null,
      tax_base_numerator: 1, tax_base_denominator: 1,
    }).select('id').single();
    if (project.error) throw new Error('AC-TPI-016 fixture project: ' + project.error.message);
    projectId = project.data.id;
    workOrderId = crypto.randomUUID();
    const wo = await admin.from('work_orders').insert({
      id: workOrderId, org_id: orgId, project_id: projectId, title: 'Inspected works ' + suffix, status: 'Issued', wo_number: 'WO-' + suffix,
      issued_at: new Date().toISOString(), order_value: 500_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    });
    if (wo.error) throw new Error('AC-TPI-016 fixture work order: ' + wo.error.message);
    inspectionId = crypto.randomUUID();
    const ins = await admin.from('third_party_inspections').insert({
      id: inspectionId, org_id: orgId, work_order_id: workOrderId, project_id: projectId, title: testName, planned_date: orgToday(),
      required_for: ['billing'], status: 'executed', invited_on: orgToday(), invited_by: profile.data.id,
      executed_on: orgToday(), executed_by: profile.data.id, created_by: profile.data.id,
    });
    if (ins.error) throw new Error('AC-TPI-016 fixture inspection: ' + ins.error.message);

    await signIn(page, 'engineer@acme.test');
    await page.goto('/work-orders/' + workOrderId);
    const card = page.getByTestId('inspection-' + inspectionId);
    await expect(card.getByTestId('inspection-status')).toHaveText('Executed');
    await card.getByTestId('inspection-file-input').setInputFiles({ name: 'weld.png', mimeType: 'image/png', buffer: PNG });
    await expect(card.getByRole('button', { name: 'weld.png' })).toBeVisible();
    await card.getByLabel('Result').selectOption('conditional');
    await card.getByRole('button', { name: 'Mark reported' }).click();
    await expect(card.getByTestId('inspection-status')).toHaveText('Reported');
    await expect(card.getByText('Conditional')).toBeVisible();
  } catch (e) {
    failure = e;
  } finally {
    if (inspectionId) {
      const files = await admin.from('third_party_inspection_files').select('file_path').eq('inspection_id', inspectionId);
      const paths = (files.data ?? []).map((f) => f.file_path);
      await cleanup('delete report files', () => admin.from('third_party_inspection_files').delete().eq('inspection_id', inspectionId));
      if (paths.length) await cleanup('delete report objects', () => admin.storage.from('inspection-reports').remove(paths));
      await cleanup('delete inspection', () => admin.from('third_party_inspections').delete().eq('id', inspectionId));
      await cleanup('delete inspection history', () => admin.from('record_changes').delete().eq('entity_id', inspectionId));
    }
    if (workOrderId) await cleanup('delete work order', () => admin.from('work_orders').delete().eq('id', workOrderId));
    if (projectId) await cleanup('delete project', () => admin.from('projects').delete().eq('id', projectId));
    if (companyId) await cleanup('delete client', () => admin.from('companies').delete().eq('id', companyId));
  }
  if (cleanupFailures.length > 0) {
    const ce = new Error('AC-TPI-016 cleanup failed: ' + cleanupFailures.join('; '));
    if (failure) throw new AggregateError([failure, ce], 'AC-TPI-016 failed and cleanup reported errors');
    throw ce;
  }
  if (failure) throw failure;
});
