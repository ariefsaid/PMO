// @e2e-isolation: self-isolated — creates its own client, project, issued work order, contract line, allocation and issued quality document with unique names, and deletes only the rows linked to this run in finally.
// AC-SCR-014 — the survey record caps the claim. A person who may record progress records a survey of a work-order line (who took part
// typed in, a quality document attached), a second person confirms it, and the claim form then measures the line against the confirmed
// survey: it shows what was surveyed and quality-ready, and warns (without blocking) when the claim passes quality-ready.
// Goal oracle: the claim form's own warning text, for a quantity typed above the certified quality-ready quantity.
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { requireServiceRoleKey, signIn } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

test.setTimeout(180_000);

test('AC-SCR-014 record a survey, confirm it as another person, raise a claim over its quality-ready quantity and see the warning', async ({ page, browser }) => {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('AC-SCR-014 requires the local fixture service client');
  const admin: SupabaseClient = createClient(requireMatchingLocalSupabaseUrls(undefined, undefined), serviceKey, { auth: { persistSession: false } });
  const suffix = 'SCR-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  let companyId = '';
  let projectId = '';
  let workOrderId = '';
  let boqId = '';
  let documentId = '';
  let failure: unknown;
  const cleanupFailures: string[] = [];
  const cleanup = async (label: string, op: () => PromiseLike<{ error: { message: string } | null }>) => {
    try { const r = await op(); if (r.error) cleanupFailures.push(label + ': ' + r.error.message); }
    catch (e) { cleanupFailures.push(label + ': ' + (e instanceof Error ? e.message : String(e))); }
  };

  try {
    const profile = await admin.from('profiles').select('id,org_id').eq('email', 'finance@acme.test').single();
    if (profile.error) throw new Error('AC-SCR-014 fixture profile: ' + profile.error.message);
    const orgId = profile.data.org_id;
    const company = await admin.from('companies').insert({ org_id: orgId, name: 'Client ' + suffix, type: 'Client' }).select('id').single();
    if (company.error) throw new Error('AC-SCR-014 fixture client: ' + company.error.message);
    companyId = company.data.id;
    const project = await admin.from('projects').insert({
      org_id: orgId, name: 'Survey project ' + suffix, status: 'Ongoing Project', currency: 'EUR', client_id: companyId,
      contract_value: 1_000_000, tax_treatment: 'exclusive', tax_amount: 0, subject_to_vat: false, tax_rate: null,
      tax_base_numerator: 1, tax_base_denominator: 1,
    }).select('id').single();
    if (project.error) throw new Error('AC-SCR-014 fixture project: ' + project.error.message);
    projectId = project.data.id;
    workOrderId = crypto.randomUUID();
    const wo = await admin.from('work_orders').insert({
      id: workOrderId, org_id: orgId, project_id: projectId, title: 'Survey journey ' + suffix, status: 'Issued', wo_number: 'WO-' + suffix,
      issued_at: new Date().toISOString(), order_value: 500_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'EUR',
    });
    if (wo.error) throw new Error('AC-SCR-014 fixture work order: ' + wo.error.message);
    boqId = crypto.randomUUID();
    const boq = await admin.from('boq_items').insert({
      id: boqId, org_id: orgId, project_id: projectId, item_code: 'SVY', description: 'Route survey', unit: 'km', quantity: 20, rate: 100, earning_basis: 'unit_rate',
    });
    if (boq.error) throw new Error('AC-SCR-014 fixture contract line: ' + boq.error.message);
    const alloc = await admin.from('work_order_lines').insert({ org_id: orgId, work_order_id: workOrderId, boq_item_id: boqId, quantity: 20 });
    if (alloc.error) throw new Error('AC-SCR-014 fixture allocation: ' + alloc.error.message);
    documentId = crypto.randomUUID();
    const doc = await admin.from('project_documents').insert({
      id: documentId, org_id: orgId, project_id: projectId, category: 'Report', title: 'Quality certificate ' + suffix, status: 'Issued',
      author_id: profile.data.id, file_path: orgId + '/' + projectId + '/' + documentId + '/quality.pdf',
    });
    if (doc.error) throw new Error('AC-SCR-014 fixture document: ' + doc.error.message);

    // Finance records the survey on the work order page: 8 km surveyed, 5 km quality-ready, a customer representative typed by name.
    await signIn(page, 'finance@acme.test');
    await page.goto('/work-orders/' + workOrderId);
    await expect(page.getByTestId('survey-empty')).toContainText('records a survey here');
    await page.getByRole('button', { name: 'Record a survey' }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel(/Contract line/).selectOption(boqId);
    await form.getByLabel(/Surveyed quantity/).fill('8');
    await form.getByLabel('Quality-ready quantity').fill('5');
    await form.getByLabel('Name').fill('Customer representative');
    await form.getByLabel('Company (optional)').fill('Customer side');
    await form.getByLabel('Quality certificate ' + suffix).check();
    await form.getByRole('button', { name: 'Save draft' }).click();
    await expect(form).toBeHidden({ timeout: 15_000 });
    await expect(page.getByTestId('survey-list')).toContainText('Customer representative (Customer side)');

    // The recorder cannot confirm their own survey: the refusal says so and what to do.
    await page.getByRole('button', { name: /Confirm SVY/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm survey' }).click();
    await expect(page.getByRole('alert')).toContainText('other than the recorder');

    // An Admin confirms it; the certified quantity shows.
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    try {
      await signIn(adminPage, 'admin@acme.test');
      await adminPage.goto('/work-orders/' + workOrderId);
      await adminPage.getByRole('button', { name: /Confirm SVY/ }).click();
      await adminPage.getByRole('dialog').getByRole('button', { name: 'Confirm survey' }).click();
      await expect(adminPage.getByTestId('survey-certified')).toContainText('certified 8 km, quality-ready 5 km', { timeout: 15_000 });
    } finally {
      await adminContext.close();
    }

    // The claim form measures the line against the confirmed survey and warns, without blocking, past quality-ready.
    await page.goto('/projects/' + projectId + '/contract');
    await page.getByRole('button', { name: 'New claim' }).click();
    const claim = page.getByRole('dialog');
    await claim.getByLabel(/^Bills$/i).selectOption(workOrderId);
    await expect(claim.getByTestId('claim-survey-' + boqId)).toContainText('Surveyed 8 km, of which quality-ready 5');
    await claim.getByLabel(/SVY/).fill('6');
    await expect(claim.getByTestId('claim-overclaim-' + boqId)).toContainText('only 5 km has quality documents');
    await expect(claim.getByRole('button', { name: 'Create claim' })).toBeEnabled();
    await claim.getByLabel(/SVY/).fill('9');
    await expect(claim.getByTestId('claim-overclaim-' + boqId)).toContainText('more than the 8 km still claimable (surveyed 8');
  } catch (e) {
    failure = e;
  } finally {
    if (projectId) {
      if (!/^[0-9a-f-]{36}$/.test(projectId)) throw new Error('Invalid fixture project id');
      // Confirmed survey records refuse deletion by design: remove this run's survey rows with triggers off, by its own project id only.
      try {
        execFileSync('docker', ['exec', '-i', 'supabase_db_pmo-portal', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1'], {
          input: `begin; set local session_replication_role = replica; delete from public.survey_record_documents where record_id in (select id from public.survey_records where project_id = '${projectId}'); delete from public.survey_participants where record_id in (select id from public.survey_records where project_id = '${projectId}'); delete from public.survey_records where project_id = '${projectId}'; commit;`,
          encoding: 'utf8',
        });
      } catch (e) { cleanupFailures.push('survey rows: ' + (e instanceof Error ? e.message : String(e))); }
      await cleanup('claims', () => admin.from('progress_claims').delete().eq('project_id', projectId));
      await cleanup('documents', () => admin.from('project_documents').delete().eq('project_id', projectId));
      await cleanup('allocations', () => admin.from('work_order_lines').delete().eq('work_order_id', workOrderId));
      await cleanup('work order', () => admin.from('work_orders').delete().eq('id', workOrderId));
      await cleanup('contract line', () => admin.from('boq_items').delete().eq('id', boqId));
      await cleanup('project', () => admin.from('projects').delete().eq('id', projectId));
    }
    if (companyId) await cleanup('client', () => admin.from('companies').delete().eq('id', companyId));
    if (failure) throw failure;
    if (cleanupFailures.length) throw new Error('AC-SCR-014 cleanup: ' + cleanupFailures.join('; '));
  }
});
