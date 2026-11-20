// A generic contract with one priced line, one work order, progress to date and one approved evidence document — the starting point of the
// billing journeys (JOB-BQ*). Rows are created by service role; `cleanupBilling` removes only this run's rows (children first).
import type { SupabaseClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { need, ok, ORG_ID } from './jobFixtures';

export interface BillingFixture {
  companyId: string; projectId: string; boqId: string; workOrderId: string; workOrderNumber: string; entryId: string; documentId: string; documentTitle: string;
}

export async function createBillingFixture(admin: SupabaseClient, run: string, opts: { progressQty?: number; workOrderValue?: number } = {}): Promise<BillingFixture> {
  const companyId = need('client', await admin.from('companies').insert({ org_id: ORG_ID, name: `${run} Client`, type: 'Client' }).select('id').single()).id as string;
  const projectId = need('project', await admin.from('projects').insert({
    org_id: ORG_ID, name: run, status: 'Ongoing Project', currency: 'IDR', client_id: companyId, contract_value: 10_000_000,
    tax_treatment: 'exclusive', tax_amount: 0, tax_rate: 12, tax_base_numerator: 11, tax_base_denominator: 12,
  }).select('id').single()).id as string;
  const boqId = need('line', await admin.from('boq_items').insert({ org_id: ORG_ID, project_id: projectId, item_code: 'SURVEY', description: 'Route survey', unit: 'km', quantity: 10, rate: 50_000 }).select('id').single()).id as string;
  const workOrderId = crypto.randomUUID();
  const workOrderNumber = `WO-${run}`;
  ok('work order', await admin.from('work_orders').insert({ id: workOrderId, org_id: ORG_ID, project_id: projectId, title: `${run} Order`, status: 'Issued', wo_number: workOrderNumber, order_value: opts.workOrderValue ?? 500_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'IDR' }));
  ok('allocation', await admin.from('work_order_lines').insert({ org_id: ORG_ID, work_order_id: workOrderId, boq_item_id: boqId, quantity: 10 }));
  const month = `${new Date().toISOString().slice(0, 7)}-01`;
  const entryId = need('progress', await admin.from('project_progress_entries').insert({ org_id: ORG_ID, project_id: projectId, month, pct_complete: 60 }).select('id').single()).id as string;
  ok('progress quantity', await admin.from('progress_assessment_quantities').insert({ org_id: ORG_ID, entry_id: entryId, boq_item_id: boqId, quantity_to_date: opts.progressQty ?? 6 }));
  const documentId = crypto.randomUUID();
  const documentTitle = `${run} survey report`;
  ok('document', await admin.from('project_documents').insert({
    id: documentId, org_id: ORG_ID, project_id: projectId, category: 'Report', title: documentTitle, revision: 'A', status: 'Approved', file_path: `${ORG_ID}/${projectId}/${documentId}/report.pdf`,
  }));
  return { companyId, projectId, boqId, workOrderId, workOrderNumber, entryId, documentId, documentTitle };
}

export async function cleanupBilling(admin: SupabaseClient, fx: BillingFixture | undefined): Promise<void> {
  if (!fx) return;
  const fail = (step: string, e: { message: string } | null) => { if (e) throw new Error(`cleanup ${step}: ${e.message}`); };
  const { projectId } = fx;
  const claims = await admin.from('progress_claims').select('id').eq('project_id', projectId);
  fail('claim read', claims.error);
  const claimIds = (claims.data ?? []).map((r: { id: string }) => r.id);
  if (!/^[0-9a-f-]{36}$/.test(projectId)) throw new Error('Invalid fixture project id');
  // Releases and stage rows are append-only for the client; the local DB is cleaned as superuser with triggers off, scoped to this project.
  execFileSync('docker', ['exec', '-i', 'supabase_db_pmo-portal', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1'], {
    input: `begin; set local session_replication_role = replica;
      delete from public.retention_releases where project_id = '${projectId}';
      delete from public.claim_billing_stage_documents where claim_id in (select id from public.progress_claims where project_id = '${projectId}');
      delete from public.claim_billing_stages where project_id = '${projectId}';
      commit;`, encoding: 'utf8',
  });
  if (claimIds.length > 0) {
    fail('evidence', (await admin.from('progress_claim_evidence').delete().in('claim_id', claimIds)).error);
    fail('claims', (await admin.from('progress_claims').delete().in('id', claimIds)).error);
  }
  fail('stage template', (await admin.from('billing_stage_templates').delete().eq('project_id', projectId)).error);
  fail('documents', (await admin.from('project_documents').delete().eq('project_id', projectId)).error);
  fail('order lines', (await admin.from('work_order_lines').delete().eq('work_order_id', fx.workOrderId)).error);
  fail('order', (await admin.from('work_orders').delete().eq('id', fx.workOrderId)).error);
  fail('assessment quantities', (await admin.from('progress_assessment_quantities').delete().eq('entry_id', fx.entryId)).error);
  fail('assessment', (await admin.from('project_progress_entries').delete().eq('id', fx.entryId)).error);
  fail('contract lines', (await admin.from('boq_items').delete().eq('project_id', projectId)).error);
  fail('project', (await admin.from('projects').delete().eq('id', projectId)).error);
  fail('company', (await admin.from('companies').delete().eq('id', fx.companyId)).error);
}

/** The project's list of billing stages: name, whether it happens in the client's own system, and its document checklist. */
export interface StageSpec { name: string; clientSide?: boolean; documents?: { name: string; required?: boolean }[] }
export async function setStageTemplate(admin: SupabaseClient, projectId: string, stages: StageSpec[]): Promise<void> {
  for (const [i, s] of stages.entries()) {
    const t = need('stage', await admin.from('billing_stage_templates').insert({ org_id: ORG_ID, project_id: projectId, position: i + 1, name: s.name, client_side: Boolean(s.clientSide) }).select('id').single());
    for (const [j, d] of (s.documents ?? []).entries()) {
      ok('stage doc', await admin.from('billing_stage_template_documents').insert({ org_id: ORG_ID, template_id: t.id, position: j + 1, name: d.name, required: d.required ?? true }));
    }
  }
}

/** Finance raises a progress claim for `qty` km of the line, from the contract area (the path AC-RET-004 proves), then opens its drawer. */
export async function raiseClaimAndOpen(page: import('@playwright/test').Page, fx: BillingFixture, qty: string): Promise<void> {
  await page.goto(`/projects/${fx.projectId}/contract`);
  await page.getByRole('button', { name: /new claim|tagihan baru/i }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel(/^(Bills|Menagih)$/i).selectOption(fx.workOrderId);
  await form.getByLabel(/SURVEY/).fill(qty);
  await form.getByRole('button', { name: /create claim|buat tagihan/i }).click();
  // The next dialog asks for the evidence document; leave it — the stages are what these journeys are about.
  const evidence = page.getByRole('dialog');
  await evidence.getByRole('button', { name: /^(close|tutup|cancel|batal|skip|lewati)/i }).first().click();
  await page.getByRole('button', { name: /open progress claim|buka tagihan progres/i }).click();
}
