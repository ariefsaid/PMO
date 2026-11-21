// @e2e-isolation: serial — an organisation area changes the Work orders tab of every project in the org while it exists; removed in finally.
// AC-WAG-010 — a PM groups a project's work orders by area and finds each under its area. Goal oracle: the grouped list
// shows one heading per area with its work orders beneath it, and "No area" for the one without.
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireServiceRoleKey, signIn } from '../helpers';
import { requireMatchingLocalSupabaseUrls } from '../../src/lib/testing/localSupabaseUrl';

test.setTimeout(90_000);

test('AC-WAG-010 grouping the work-order list by area shows each work order under its area', async ({ page }) => {
  const serviceKey = requireServiceRoleKey();
  if (!serviceKey) throw new Error('AC-WAG-010 requires the local fixture service client');
  const admin: SupabaseClient = createClient(requireMatchingLocalSupabaseUrls(undefined, undefined), serviceKey, { auth: { persistSession: false } });
  const suffix = 'WAG-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const areaName = 'Area ' + suffix;
  let companyId = ''; let projectId = ''; let areaId = '';
  const woIds: string[] = [];
  let failure: unknown;
  const cleanupFailures: string[] = [];
  const cleanup = async (label: string, op: () => PromiseLike<{ error: { message: string } | null }>) => {
    try { const r = await op(); if (r.error) cleanupFailures.push(label + ': ' + r.error.message); }
    catch (e) { cleanupFailures.push(label + ': ' + (e instanceof Error ? e.message : String(e))); }
  };
  try {
    const profile = await admin.from('profiles').select('org_id').eq('email', 'finance@acme.test').single();
    if (profile.error) throw new Error('AC-WAG-010 fixture profile: ' + profile.error.message);
    const orgId = profile.data.org_id;
    const company = await admin.from('companies').insert({ org_id: orgId, name: 'Client ' + suffix, type: 'Client' }).select('id').single();
    if (company.error) throw new Error('AC-WAG-010 fixture client: ' + company.error.message);
    companyId = company.data.id;
    const project = await admin.from('projects').insert({
      org_id: orgId, name: 'Area project ' + suffix, status: 'Ongoing Project', currency: 'EUR', client_id: companyId,
      contract_value: 1_000_000, tax_treatment: 'exclusive', tax_amount: 0, subject_to_vat: false, tax_rate: null,
      tax_base_numerator: 1, tax_base_denominator: 1,
    }).select('id').single();
    if (project.error) throw new Error('AC-WAG-010 fixture project: ' + project.error.message);
    projectId = project.data.id;
    const area = await admin.from('work_order_areas').insert({ org_id: orgId, code: 'E' + Date.now().toString().slice(-8), name: areaName }).select('id').single();
    if (area.error) throw new Error('AC-WAG-010 fixture area: ' + area.error.message);
    areaId = area.data.id;
    for (const [n, withArea] of [['One', true], ['Two', false]] as const) {
      const id = crypto.randomUUID();
      const wo = await admin.from('work_orders').insert({
        id, org_id: orgId, project_id: projectId, title: 'Order ' + n + ' ' + suffix, status: 'Issued', wo_number: 'WO-' + n + '-' + suffix,
        issued_at: new Date().toISOString(), order_value: 100_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'EUR',
        area_id: withArea ? areaId : null,
      });
      if (wo.error) throw new Error('AC-WAG-010 fixture work order: ' + wo.error.message);
      woIds.push(id);
    }

    await signIn(page, 'finance@acme.test');
    await page.route('**/api/resource/**', (route) => route.abort());
    await page.goto('/projects/' + projectId + '/contract');
    await page.getByRole('combobox', { name: 'Group by' }).selectOption('area');

    const grouped = page.getByTestId('wo-group-' + areaId);
    await expect(grouped.getByRole('heading', { level: 3 })).toContainText(areaName);
    await expect(grouped.getByTestId('customer-order-' + woIds[0])).toBeVisible();
    await expect(page.getByTestId('wo-group-none').getByTestId('customer-order-' + woIds[1])).toBeVisible();
    await expect(page.getByTestId('wo-group-none').getByRole('heading', { level: 3 })).toContainText('No area');
  } catch (e) {
    failure = e;
  } finally {
    for (const id of woIds) await cleanup('delete work order', () => admin.from('work_orders').delete().eq('id', id));
    if (areaId) await cleanup('delete area', () => admin.from('work_order_areas').delete().eq('id', areaId));
    if (projectId) await cleanup('delete project', () => admin.from('projects').delete().eq('id', projectId));
    if (companyId) await cleanup('delete client', () => admin.from('companies').delete().eq('id', companyId));
  }
  if (cleanupFailures.length > 0) {
    const ce = new Error('AC-WAG-010 cleanup failed: ' + cleanupFailures.join('; '));
    if (failure) throw new AggregateError([failure, ce], 'AC-WAG-010 failed and cleanup reported errors');
    throw ce;
  }
  if (failure) throw failure;
});
