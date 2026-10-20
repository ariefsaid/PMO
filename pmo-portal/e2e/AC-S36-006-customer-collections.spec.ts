// @e2e-isolation: self-isolated — owns one generated test tenant, user, customer, invoice and AR row; operational rows are fingerprint-checked and removed while append-only evidence remains.
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type TestInfo } from '@playwright/test';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';
import { requireServiceRoleKey, waitForFonts } from './helpers';

const localApiUrl = requireMatchingLocalSupabaseUrls(undefined, undefined);
const serviceRoleKey = requireServiceRoleKey();
if (!serviceRoleKey) {
  throw new Error('AC-S36-006 requires the local service-role fixture client; run through the local e2e wrapper.');
}

const admin = createClient(localApiUrl, serviceRoleKey, { auth: { persistSession: false } });
const BALANCE = 4250;
const SOURCE_RANGE_LABELS = {
  range1: 'Current',
  range2: '1–30',
  range3: '31–60',
  range4: '61–90',
  range5: '90+',
};

interface FixturePlan {
  runId: string;
  orgId: string;
  orgName: string;
  financeEmail: string;
  financeFullName: string;
  financePassword: string;
  financeId: string | null;
  companyId: string;
  companyName: string;
  externalRefId: string;
  erpCustomerId: string;
  invoiceId: string;
  invoiceNumber: string;
  referenceMarker: string;
  invoiceDate: string;
  dueDate: string;
  snapshotRowId: string;
  snapshotId: string;
  reportDate: string;
  asOf: string;
  completedWrites: string[];
  completedDeletes: string[];
}

function shiftUtcDay(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function utcToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function createFixturePlan(): FixturePlan {
  const runId = crypto.randomUUID();
  const suffix = runId.replaceAll('-', '').slice(0, 12).toUpperCase();
  const reportDate = utcToday();
  return {
    runId,
    orgId: crypto.randomUUID(),
    orgName: `AC-S36-006 test ${suffix}`,
    financeEmail: `s36-${runId}@example.invalid`,
    financeFullName: `S36 Finance ${runId.slice(0, 8)}`,
    financePassword: `${crypto.randomUUID()}-Aa1!`,
    financeId: null,
    companyId: crypto.randomUUID(),
    companyName: `S36 Collections ${suffix}`,
    externalRefId: crypto.randomUUID(),
    erpCustomerId: `Customer:S36-Customer-${suffix}`,
    invoiceId: crypto.randomUUID(),
    invoiceNumber: `S36-${suffix}`,
    referenceMarker: `AC-S36-006:${runId}`,
    invoiceDate: shiftUtcDay(reportDate, -121),
    dueDate: shiftUtcDay(reportDate, -91),
    snapshotRowId: crypto.randomUUID(),
    snapshotId: crypto.randomUUID(),
    reportDate,
    asOf: `${reportDate}T12:00:00.000Z`,
    completedWrites: [],
    completedDeletes: [],
  };
}

function ledgerPath(testInfo: TestInfo, fixture: FixturePlan): string {
  const directory = path.dirname(testInfo.outputPath(`ac-s36-006-${fixture.runId}.json`));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  return testInfo.outputPath(`ac-s36-006-${fixture.runId}.json`);
}

function persistLedger(filePath: string, fixture: FixturePlan): void {
  const data = `${JSON.stringify({
    acceptance: 'AC-S36-006',
    runId: fixture.runId,
    plannedIds: {
      orgId: fixture.orgId,
      financeId: fixture.financeId,
      companyId: fixture.companyId,
      externalRefId: fixture.externalRefId,
      invoiceId: fixture.invoiceId,
      snapshotRowId: fixture.snapshotRowId,
      snapshotId: fixture.snapshotId,
    },
    recoveryEmail: fixture.financeEmail,
    markers: {
      orgName: fixture.orgName,
      financeFullName: fixture.financeFullName,
      companyName: fixture.companyName,
      erpCustomerId: fixture.erpCustomerId,
      invoiceNumber: fixture.invoiceNumber,
      referenceMarker: fixture.referenceMarker,
    },
    plannedWindow: {
      currency: 'USD',
      reportDate: fixture.reportDate,
      dueDate: fixture.dueDate,
      bucket: '90+',
      outstanding: BALANCE,
    },
    completedWrites: fixture.completedWrites,
    completedDeletes: fixture.completedDeletes,
    appendOnlyExpectation: {
      successfulJourney: { record_changes: 2, audit_events: 3, sales_invoice_authors: 0, external_command_outbox: 0 },
      cleanup: 'retain all audit_events and record_changes; leave the exact test organization inert',
    },
  }, null, 2)}\n`;
  const temporaryPath = `${filePath}.tmp`;
  const descriptor = openSync(temporaryPath, 'wx', 0o600);
  try {
    writeFileSync(descriptor, data, { encoding: 'utf8' });
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, filePath);
  const directoryDescriptor = openSync(path.dirname(filePath), 'r');
  try {
    fsyncSync(directoryDescriptor);
  } finally {
    closeSync(directoryDescriptor);
  }
}

function requireNoQueryError(step: string, error: { message: string } | null): void {
  if (error) throw new Error(`AC-S36-006 ${step} failed; no further fixture writes or deletes are safe.`);
}

async function requireEmptyProbe<T>(step: string, query: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<void> {
  const { data, error } = await query;
  requireNoQueryError(step, error);
  if (data) throw new Error(`AC-S36-006 ${step} collided with a pre-existing row; no fixture writes were attempted.`);
}

async function requireUnusedEmail(client: SupabaseClient, email: string): Promise<void> {
  const perPage = 1000;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error('AC-S36-006 could not confirm the synthetic Finance login is unused; no fixture writes were attempted.');
    if (data.users.some((user) => user.email === email)) {
      throw new Error('AC-S36-006 generated a Finance login that already exists; no fixture writes were attempted.');
    }
    if (data.users.length < perPage) return;
  }
  throw new Error('AC-S36-006 could not complete the bounded login uniqueness check; no fixture writes were attempted.');
}

async function preflight(client: SupabaseClient, fixture: FixturePlan): Promise<void> {
  await requireUnusedEmail(client, fixture.financeEmail);
  await Promise.all([
    requireEmptyProbe('tenant ID', client.from('organizations').select('id').eq('id', fixture.orgId).maybeSingle()),
    requireEmptyProbe('company ID', client.from('companies').select('id').eq('id', fixture.companyId).maybeSingle()),
    requireEmptyProbe('external-reference ID', client.from('external_refs').select('id').eq('id', fixture.externalRefId).maybeSingle()),
    requireEmptyProbe('invoice ID', client.from('sales_invoices').select('id').eq('id', fixture.invoiceId).maybeSingle()),
    requireEmptyProbe('invoice number', client.from('sales_invoices').select('id')
      .eq('org_id', fixture.orgId).eq('si_number', fixture.invoiceNumber).maybeSingle()),
    requireEmptyProbe('snapshot row ID', client.from('erp_ar_aging_snapshot').select('id')
      .eq('id', fixture.snapshotRowId).maybeSingle()),
    requireEmptyProbe('snapshot generation ID', client.from('erp_ar_aging_snapshot').select('id')
      .eq('org_id', fixture.orgId).eq('snapshot_id', fixture.snapshotId).maybeSingle()),
    requireEmptyProbe('tenant company inventory', client.from('companies').select('id').eq('org_id', fixture.orgId).limit(1).maybeSingle()),
    requireEmptyProbe('tenant customer-mapping inventory', client.from('external_refs').select('id').eq('org_id', fixture.orgId).limit(1).maybeSingle()),
    requireEmptyProbe('tenant invoice inventory', client.from('sales_invoices').select('id').eq('org_id', fixture.orgId).limit(1).maybeSingle()),
    requireEmptyProbe('tenant AR inventory', client.from('erp_ar_aging_snapshot').select('id').eq('org_id', fixture.orgId).limit(1).maybeSingle()),
    requireEmptyProbe('tenant history inventory', client.from('record_changes').select('id').eq('org_id', fixture.orgId).limit(1).maybeSingle()),
    requireEmptyProbe('tenant audit inventory', client.from('audit_events').select('id').eq('org_id', fixture.orgId).limit(1).maybeSingle()),
    requireEmptyProbe('tenant outbox inventory', client.from('external_command_outbox').select('id').eq('org_id', fixture.orgId).limit(1).maybeSingle()),
    requireEmptyProbe('tenant authorship inventory', client.from('sales_invoice_authors').select('sales_invoice_id').eq('org_id', fixture.orgId).limit(1).maybeSingle()),
    requireEmptyProbe('tenant membership inventory', client.from('profiles').select('id').eq('org_id', fixture.orgId).limit(1).maybeSingle()),
  ]);
}

async function readOwnedCompany(client: SupabaseClient, f: FixturePlan) {
  const { data, error } = await client.from('companies').select('id,org_id,name,type')
    .eq('id', f.companyId).eq('org_id', f.orgId).maybeSingle();
  requireNoQueryError('company ownership probe', error);
  if (!data) return null;
  if (data.name !== f.companyName || data.type !== 'Client') {
    throw new Error('AC-S36-006 found an unexpected company at its owned ID; preserving it for reconciliation.');
  }
  return data;
}

async function readOwnedRef(client: SupabaseClient, f: FixturePlan) {
  const { data, error } = await client.from('external_refs')
    .select('id,org_id,domain,pmo_record_id,external_tier,external_record_id')
    .eq('id', f.externalRefId).eq('org_id', f.orgId).maybeSingle();
  requireNoQueryError('customer mapping ownership probe', error);
  if (!data) return null;
  if (data.domain !== 'companies' || data.pmo_record_id !== f.companyId
    || data.external_tier !== 'erpnext' || data.external_record_id !== f.erpCustomerId) {
    throw new Error('AC-S36-006 found an unexpected customer mapping at its owned ID; preserving it for reconciliation.');
  }
  return data;
}

async function readOwnedInvoice(client: SupabaseClient, f: FixturePlan) {
  const { data, error } = await client.from('sales_invoices')
    .select('id,org_id,project_id,customer_id,si_number,reference_number,invoice_date,erp_due_date,amount,erp_outstanding_amount,currency,status,erp_docstatus,tax_treatment,tax_amount,pmo_native')
    .eq('id', f.invoiceId).eq('org_id', f.orgId).maybeSingle();
  requireNoQueryError('invoice ownership probe', error);
  if (!data) return null;
  if (data.project_id !== null || data.customer_id !== f.companyId || data.si_number !== f.invoiceNumber
    || data.reference_number !== f.referenceMarker || data.invoice_date !== f.invoiceDate
    || data.erp_due_date !== f.dueDate || Number(data.amount) !== BALANCE
    || Number(data.erp_outstanding_amount) !== BALANCE || data.currency !== 'USD'
    || data.status !== 'Unpaid' || data.erp_docstatus !== 1 || data.tax_treatment !== 'exclusive'
    || Number(data.tax_amount) !== 0 || data.pmo_native !== false) {
    throw new Error('AC-S36-006 found an unexpected invoice at its owned ID; preserving it for reconciliation.');
  }
  return data;
}

async function readOwnedSnapshot(client: SupabaseClient, f: FixturePlan) {
  const { data, error } = await client.from('erp_ar_aging_snapshot')
    .select('id,org_id,party,party_type,company_id,currency,total_outstanding,current,b_0_30,b_31_60,b_61_90,b_90_plus,range_labels,report_date,ageing_based_on,as_of,source_report,report_version,snapshot_id')
    .eq('id', f.snapshotRowId).eq('org_id', f.orgId).maybeSingle();
  requireNoQueryError('AR snapshot ownership probe', error);
  if (!data) return null;
  const actualRangeLabels = data.range_labels && typeof data.range_labels === 'object'
    ? Object.entries(data.range_labels).sort(([left], [right]) => left.localeCompare(right))
    : [];
  const expectedRangeLabels = Object.entries(SOURCE_RANGE_LABELS).sort(([left], [right]) => left.localeCompare(right));
  if (data.party !== f.erpCustomerId || data.party_type !== 'Customer' || data.company_id !== null
    || data.currency !== 'USD' || Number(data.total_outstanding) !== BALANCE
    || Number(data.current) !== 0 || Number(data.b_0_30) !== 0 || Number(data.b_31_60) !== 0
    || Number(data.b_61_90) !== 0 || Number(data.b_90_plus) !== BALANCE
    || JSON.stringify(actualRangeLabels) !== JSON.stringify(expectedRangeLabels) || data.report_date !== f.reportDate
    || data.ageing_based_on !== 'Due Date' || Date.parse(data.as_of) !== Date.parse(f.asOf)
    || data.source_report !== 'Accounts Receivable' || data.report_version !== '15'
    || data.snapshot_id !== f.snapshotId) {
    throw new Error('AC-S36-006 found an unexpected AR row at its owned ID; preserving it for reconciliation.');
  }
  return data;
}

async function findOwnedAuthUser(client: SupabaseClient, f: FixturePlan): Promise<string | null> {
  if (f.financeId) {
    const { data, error } = await client.auth.admin.getUserById(f.financeId);
    if (error) throw new Error('AC-S36-006 could not verify its Finance user; preserving it for reconciliation.');
    if (!data.user) return null;
    if (data.user.email !== f.financeEmail || data.user.user_metadata?.ac_s36_run_id !== f.runId) {
      throw new Error('AC-S36-006 found an unexpected Finance user at its owned ID; preserving it for reconciliation.');
    }
    return data.user.id;
  }

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error('AC-S36-006 could not reconcile the synthetic Finance login; preserving it for review.');
    const matches = data.users.filter((user) => user.email === f.financeEmail);
    if (matches.length > 1 || matches.some((user) => user.user_metadata?.ac_s36_run_id !== f.runId)) {
      throw new Error('AC-S36-006 could not prove unique ownership of the Finance login; preserving it for review.');
    }
    if (matches[0]) return matches[0].id;
    if (data.users.length < 1000) return null;
  }
  throw new Error('AC-S36-006 could not complete the bounded Finance-login reconciliation; preserving it for review.');
}

async function deleteExact(
  step: string,
  client: SupabaseClient,
  table: string,
  id: string,
  orgId: string,
  ownerFields: Record<string, unknown>,
): Promise<void> {
  let query = client.from(table).delete().eq('id', id).eq('org_id', orgId);
  for (const [field, value] of Object.entries(ownerFields)) query = query.eq(field, value);
  const { data, error } = await query.select('id');
  if (error) {
    let probe = client.from(table).select('id').eq('id', id).eq('org_id', orgId);
    for (const [field, value] of Object.entries(ownerFields)) probe = probe.eq(field, value);
    const { data: remaining, error: probeError } = await probe.maybeSingle();
    if (probeError || remaining) {
      throw new Error(`AC-S36-006 ${step} outcome is uncertain; preserve remaining fixture rows for reconciliation.`);
    }
    return;
  }
  if (data?.length === 1) return;
  throw new Error(`AC-S36-006 ${step} did not affect exactly the owned row; preserve remaining fixture rows.`);
}

async function assertDurableEffects(client: SupabaseClient, f: FixturePlan): Promise<void> {
  const [changes, events, authors, outbox, operational, profiles, organization] = await Promise.all([
    client.from('record_changes').select('entity_type,entity_id,op').eq('org_id', f.orgId),
    client.from('audit_events').select('action,entity_id').eq('org_id', f.orgId),
    client.from('sales_invoice_authors').select('sales_invoice_id').eq('org_id', f.orgId),
    client.from('external_command_outbox').select('id').eq('org_id', f.orgId),
    Promise.all([
      client.from('companies').select('id').eq('org_id', f.orgId),
      client.from('external_refs').select('id').eq('org_id', f.orgId),
      client.from('sales_invoices').select('id').eq('org_id', f.orgId),
      client.from('erp_ar_aging_snapshot').select('id').eq('org_id', f.orgId),
    ]),
    f.financeId
      ? client.from('profiles').select('id').eq('id', f.financeId)
      : Promise.resolve({ data: [], error: null }),
    client.from('organizations').select('id,name,default_currency,default_timezone,lifecycle_state').eq('id', f.orgId).maybeSingle(),
  ]);
  if ([changes.error, events.error, authors.error, outbox.error, profiles.error, organization.error].some(Boolean)
    || operational.some((result) => result.error)) {
    throw new Error('AC-S36-006 could not verify final cleanup and append-only effects; preserve the tenant for reconciliation.');
  }

  const expectedChanges = [
    ...(f.completedWrites.includes('company') ? [`company:${f.companyId}:insert`] : []),
    ...(f.completedWrites.includes('erp-invoice') ? [`sales_invoice:${f.invoiceId}:insert`] : []),
  ].sort();
  const actualChanges = (changes.data ?? []).map((row) => `${row.entity_type}:${row.entity_id}:${row.op}`).sort();
  const expectedAudit = [
    ...(f.completedWrites.includes('erp-invoice') ? [`sales_invoice.create:${f.invoiceId}`] : []),
    ...f.completedDeletes.map((event) => `${event}:${event === 'company.delete' ? f.companyId : f.invoiceId}`),
  ].sort();
  const actualAudit = (events.data ?? []).map((row) => `${row.action}:${row.entity_id}`).sort();
  if (actualChanges.length !== expectedChanges.length
    || actualChanges.some((event, index) => event !== expectedChanges[index])
    || actualAudit.length !== expectedAudit.length
    || actualAudit.some((event, index) => event !== expectedAudit[index])
    || authors.data?.length !== 0 || outbox.data?.length !== 0
    || operational.some((result) => result.data?.length !== 0)
    || profiles.data?.length !== 0
    || f.completedWrites.includes('organization') !== Boolean(organization.data)
    || (organization.data !== null && (organization.data.name !== f.orgName
      || organization.data.default_currency !== 'USD' || organization.data.default_timezone !== 'UTC'
      || organization.data.lifecycle_state !== 'test'))) {
    throw new Error('AC-S36-006 final state or retained record-history effects differ from the admitted fixture ledger.');
  }
}

async function cleanup(client: SupabaseClient, fixture: FixturePlan, ledger: string): Promise<void> {
  const snapshot = await readOwnedSnapshot(client, fixture);
  if (snapshot) await deleteExact('AR snapshot cleanup', client, 'erp_ar_aging_snapshot', fixture.snapshotRowId, fixture.orgId, {
    party: fixture.erpCustomerId, snapshot_id: fixture.snapshotId,
  });

  const externalRef = await readOwnedRef(client, fixture);
  if (externalRef) await deleteExact('customer mapping cleanup', client, 'external_refs', fixture.externalRefId, fixture.orgId, {
    domain: 'companies', pmo_record_id: fixture.companyId, external_tier: 'erpnext', external_record_id: fixture.erpCustomerId,
  });

  const invoice = await readOwnedInvoice(client, fixture);
  if (invoice) {
    if (!fixture.completedWrites.includes('erp-invoice')) {
      fixture.completedWrites.push('erp-invoice');
      persistLedger(ledger, fixture);
    }
    await deleteExact('invoice cleanup', client, 'sales_invoices', fixture.invoiceId, fixture.orgId, {
      customer_id: fixture.companyId, si_number: fixture.invoiceNumber, reference_number: fixture.referenceMarker,
    });
    fixture.completedDeletes.push('sales_invoice.delete');
    persistLedger(ledger, fixture);
  }

  const company = await readOwnedCompany(client, fixture);
  if (company) {
    if (!fixture.completedWrites.includes('company')) {
      fixture.completedWrites.push('company');
      persistLedger(ledger, fixture);
    }
    await deleteExact('company cleanup', client, 'companies', fixture.companyId, fixture.orgId, {
      name: fixture.companyName, type: 'Client',
    });
    fixture.completedDeletes.push('company.delete');
    persistLedger(ledger, fixture);
  }

  const financeId = await findOwnedAuthUser(client, fixture);
  fixture.financeId = financeId;
  if (financeId) persistLedger(ledger, fixture);
  if (financeId) {
    const { data: profile, error } = await client.from('profiles').select('id,org_id,email,full_name,role,status,locale,timezone')
      .eq('id', financeId).maybeSingle();
    requireNoQueryError('Finance profile ownership probe', error);
    if (profile && (profile.org_id !== fixture.orgId || profile.email !== fixture.financeEmail
      || profile.full_name !== fixture.financeFullName || profile.role !== 'Finance'
      || profile.status !== 'active' || profile.locale !== 'en' || profile.timezone !== 'UTC')) {
      throw new Error('AC-S36-006 found an unexpected Finance profile; preserving it for reconciliation.');
    }
    const { error: deleteError } = await client.auth.admin.deleteUser(financeId);
    if (deleteError) {
      try {
        await requireUnusedEmail(client, fixture.financeEmail);
      } catch {
        throw new Error('AC-S36-006 Finance user cleanup failed; preserve the tenant for reconciliation.');
      }
    }
  }

  await requireUnusedEmail(client, fixture.financeEmail);
  const { data: organization, error: organizationError } = await client.from('organizations')
    .select('id,name,default_currency,default_timezone,lifecycle_state').eq('id', fixture.orgId).maybeSingle();
  requireNoQueryError('test-tenant ownership probe', organizationError);
  if (organization && (organization.name !== fixture.orgName || organization.default_currency !== 'USD'
    || organization.default_timezone !== 'UTC' || organization.lifecycle_state !== 'test')) {
    throw new Error('AC-S36-006 found an unexpected tenant at its owned ID; preserving it for reconciliation.');
  }
  if (organization && !fixture.completedWrites.includes('organization')) {
    fixture.completedWrites.push('organization');
    persistLedger(ledger, fixture);
  }

  await assertDurableEffects(client, fixture);
}

async function insertOwnedRows(client: SupabaseClient, fixture: FixturePlan, ledger: string): Promise<void> {
  const createResult = await client.auth.admin.createUser({
    email: fixture.financeEmail,
    password: fixture.financePassword,
    email_confirm: true,
    user_metadata: { ac_s36_run_id: fixture.runId },
  });
  if (createResult.error || !createResult.data.user) {
    throw new Error('AC-S36-006 could not create the synthetic Finance user.');
  }
  fixture.financeId = createResult.data.user.id;
  fixture.completedWrites.push('auth-user');
  persistLedger(ledger, fixture);

  const organization = await client.from('organizations').insert({
    id: fixture.orgId, name: fixture.orgName, default_currency: 'USD', default_timezone: 'UTC',
    default_locale: 'en', lifecycle_state: 'test',
  }).select('id').single();
  requireNoQueryError('test-tenant setup', organization.error);
  if (!organization.data) throw new Error('AC-S36-006 test-tenant setup returned no owned row.');
  fixture.completedWrites.push('organization');
  persistLedger(ledger, fixture);

  const profile = await client.from('profiles').insert({
    id: fixture.financeId, org_id: fixture.orgId, email: fixture.financeEmail,
    full_name: fixture.financeFullName, role: 'Finance', status: 'active', locale: 'en', timezone: 'UTC',
  }).select('id').single();
  requireNoQueryError('Finance membership setup', profile.error);
  if (!profile.data) throw new Error('AC-S36-006 Finance membership setup returned no owned row.');
  fixture.completedWrites.push('finance-profile');
  persistLedger(ledger, fixture);

  const company = await client.from('companies').insert({
    id: fixture.companyId, org_id: fixture.orgId, name: fixture.companyName, type: 'Client',
  }).select('id').single();
  requireNoQueryError('customer setup', company.error);
  if (!company.data) throw new Error('AC-S36-006 customer setup returned no owned row.');
  fixture.completedWrites.push('company');
  persistLedger(ledger, fixture);

  const ref = await client.from('external_refs').insert({
    id: fixture.externalRefId, org_id: fixture.orgId, domain: 'companies',
    pmo_record_id: fixture.companyId, external_tier: 'erpnext', external_record_id: fixture.erpCustomerId,
  }).select('id').single();
  requireNoQueryError('canonical customer mapping setup', ref.error);
  if (!ref.data) throw new Error('AC-S36-006 customer mapping setup returned no owned row.');
  fixture.completedWrites.push('customer-mapping');
  persistLedger(ledger, fixture);

  const invoice = await client.from('sales_invoices').insert({
    id: fixture.invoiceId, org_id: fixture.orgId, project_id: null, customer_id: fixture.companyId,
    si_number: fixture.invoiceNumber, reference_number: fixture.referenceMarker,
    invoice_date: fixture.invoiceDate, erp_due_date: fixture.dueDate,
    amount: BALANCE, erp_outstanding_amount: BALANCE, currency: 'USD',
    status: 'Unpaid', erp_docstatus: 1, tax_treatment: 'exclusive', tax_amount: 0, pmo_native: false,
  }).select('id').single();
  requireNoQueryError('ERP-owned invoice setup', invoice.error);
  if (!invoice.data) throw new Error('AC-S36-006 invoice setup returned no owned row.');
  fixture.completedWrites.push('erp-invoice');
  persistLedger(ledger, fixture);

  const snapshot = await client.from('erp_ar_aging_snapshot').insert({
    id: fixture.snapshotRowId, org_id: fixture.orgId, party: fixture.erpCustomerId, party_type: 'Customer',
    company_id: null, currency: 'USD', total_outstanding: BALANCE,
    current: 0, b_0_30: 0, b_31_60: 0, b_61_90: 0, b_90_plus: BALANCE,
    range_labels: { range1: 'Current', range2: '1–30', range3: '31–60', range4: '61–90', range5: '90+' },
    report_date: fixture.reportDate, ageing_based_on: 'Due Date', as_of: fixture.asOf,
    source_report: 'Accounts Receivable', report_version: '15', snapshot_id: fixture.snapshotId,
  }).select('id').single();
  requireNoQueryError('ERP AR source row setup', snapshot.error);
  if (!snapshot.data) throw new Error('AC-S36-006 AR source row setup returned no owned row.');
  fixture.completedWrites.push('ar-snapshot-row');
  persistLedger(ledger, fixture);
}

test('AC-S36-006: Finance follows one customer’s source aging position to its overdue invoice', async ({ page }, testInfo) => {
  const fixture = createFixturePlan();
  const ledger = ledgerPath(testInfo, fixture);
  persistLedger(ledger, fixture);
  await preflight(admin, fixture);

  let journeyFailure: unknown;
  try {
    await insertOwnedRows(admin, fixture, ledger);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(fixture.financeEmail);
    await page.getByLabel(/password/i).fill(fixture.financePassword);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/$/);

    const customerLink = page.getByRole('link', { name: fixture.erpCustomerId, exact: true });
    await expect(customerLink).toBeVisible();
    await waitForFonts(page);
    await expect(customerLink).toHaveAttribute('href', `/companies/${fixture.companyId}#collections`);
    await customerLink.click();
    await expect(page).toHaveURL(`/companies/${fixture.companyId}#collections`);

    const collections = page.locator('#collections');
    await expect(collections.getByRole('heading', { name: 'Customer collections', exact: true })).toBeVisible();
    await waitForFonts(page);
    await expect(collections.getByText(fixture.erpCustomerId, { exact: true })).toBeVisible();
    await expect(collections).toContainText(fixture.reportDate);
    await expect(collections).toContainText('Due Date');
    await expect(collections).toContainText('range5: 90+');
    await expect(collections).toContainText('Accounts Receivable');
    const sourcePosition = collections.getByRole('row').filter({ hasText: fixture.erpCustomerId });
    await expect(collections.getByRole('columnheader', { name: '90+' })).toBeVisible();
    // RD-015 (#1234): the aging cell shows the currency once, as its symbol — not "$4,250 USD".
    await expect(sourcePosition.getByRole('cell').nth(5)).toHaveText('$4,250');

    const overdueLink = collections.getByRole('link', { name: 'Overdue invoices first', exact: true });
    await expect(overdueLink).toHaveAttribute('href', `/sales-invoices?customer=${fixture.companyId}&overdue=true&sort=oldest-overdue`);
    await overdueLink.click();
    await expect(page).toHaveURL(`/sales-invoices?customer=${fixture.companyId}&overdue=true&sort=oldest-overdue`);
    await expect(page.getByTestId('customer-filter')).toContainText(fixture.companyName);
    await expect(page.getByRole('button', { name: /overdue only/i })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /oldest overdue first/i })).toHaveAttribute('aria-pressed', 'true');
    const overdueInvoice = page.getByRole('row').filter({ hasText: fixture.invoiceNumber });
    await expect(overdueInvoice).toBeVisible();
    await waitForFonts(page);
    await expect(overdueInvoice).toContainText(fixture.companyName);
    await expect(overdueInvoice).toContainText('USD');
    await expect(overdueInvoice).toContainText(/\d+ days overdue/);
  } catch (error) {
    journeyFailure = error;
  }

  try {
    await cleanup(admin, fixture, ledger);
  } catch (cleanupFailure) {
    if (journeyFailure) {
      throw new AggregateError(
        [journeyFailure, cleanupFailure],
        'AC-S36-006 journey and exact-owner cleanup both failed.',
        { cause: cleanupFailure },
      );
    }
    throw cleanupFailure;
  }
  if (journeyFailure) throw journeyFailure;
});
