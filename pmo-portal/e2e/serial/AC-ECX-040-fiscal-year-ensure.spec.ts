// @e2e-isolation: serial — uses disposable ERPNext companies, bindings and fiscal years with served sweep.
/**
 * AC-ECX-040 (#1599 ECX-5) — Served isolated ERP proof for fiscal year ensure.
 * Tests full end-to-end integration with real Supabase Edge Functions, real Postgres,
 * and real served ERPNext bench.
 *
 * Covers:
 * 1. Happy path: creates next fiscal year in ERP, confirms outbox intent, updates config to ready,
 *    and proves idempotent second run with zero duplicate creates.
 * 2. Overlap / disabled year: detects disabled/overlapping fiscal year, flags needs-operator
 *    (reason: disabled-year), and creates no duplicate/conflicting year.
 * 3. Restricted role 403: when ERP role lacks Fiscal Year permission, flags needs-operator
 *    (reason: missing-role).
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  AUTH_URL,
  SERVICE_KEY,
  FUNCTIONS_URL,
  READY,
  activateBinding,
  bench,
  benchCreate,
  benchList,
  createBenchCompany,
  createOrg,
  dropBenchRun,
  dropOrg,
} from './_ecaHelpers';
import { runFullSweep } from './_sweepHelpers';

if (FUNCTIONS_URL && !READY) {
  throw new Error('AC-ECX-040: the served lane is up but its disposable ERP fixture env is incomplete: never a silent skip.');
}
test.skip(!READY, 'AC-ECX-040 requires the served lane and the prepared ERPNext bed.');
test.setTimeout(600_000);

async function deleteFiscalYearQuiet(name: string): Promise<void> {
  try {
    await bench('DELETE', `/api/resource/Fiscal%20Year/${encodeURIComponent(name)}`);
  } catch {
    // best-effort cleanup
  }
}

test('AC-ECX-040 served ERPNext fiscal year ensure: sweep creates exactly one next year and preserves on second run', async () => {
  const admin = createClient(AUTH_URL, SERVICE_KEY);
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const org = await createOrg(admin, suffix);
  let company: string | undefined;
  const createdYears: string[] = [];

  try {
    company = await createBenchCompany(suffix);

    // Seed disposable current fiscal year for this company (2025-12-16 to 2026-12-15, ends in 25 days <= 45 days).
    // The next year span is 2026-12-16 to 2027-12-15.
    const curYearName = `FY-CUR-${suffix}`;
    createdYears.push(curYearName);
    await benchCreate('Fiscal Year', {
      year: curYearName,
      year_start_date: '2025-12-16',
      year_end_date: '2026-12-15',
      companies: [{ company }],
    });

    await activateBinding(admin, org.orgId, company, []);

    // Run 1: First full sweep tick
    const firstSweep = await runFullSweep(FUNCTIONS_URL, org.orgId);
    expect(firstSweep.status).toBe(200);

    // Verify next year created in ERPNext for this company
    const erpYears = await benchList(
      'Fiscal Year',
      [['Fiscal Year Company', 'company', '=', company]],
      ['name', 'year_start_date', 'year_end_date'],
    );

    // Two years total for this company: current seeded year + newly created next year
    expect(erpYears.length, 'Current seeded year and newly created next year exist for this company').toBe(2);
    const nextYear = erpYears.find((y) => String(y.name) !== curYearName);
    expect(nextYear, 'Next fiscal year created').toBeDefined();
    createdYears.push(String(nextYear!.name));

    expect(nextYear!.year_start_date).toBe('2026-12-16');
    expect(nextYear!.year_end_date).toBe('2027-12-15');

    // Verify Supabase DB outbox and intent state
    const { data: intents } = await admin
      .from('erp_fiscal_year_intents')
      .select('*')
      .eq('org_id', org.orgId);
    expect(intents?.length).toBe(1);
    expect(intents?.[0].post_started_at).not.toBeNull();

    const { data: outbox } = await admin
      .from('external_command_outbox')
      .select('*')
      .eq('org_id', org.orgId)
      .eq('domain', 'fiscal_year_setup');
    expect(outbox?.length).toBe(1);
    expect(outbox?.[0].state).toBe('confirmed');

    const { data: binding } = await admin
      .from('external_org_bindings')
      .select('config')
      .eq('org_id', org.orgId)
      .single();
    const fyConfig = (binding?.config as Record<string, unknown>)?.fiscal_year as Record<string, unknown>;
    expect(fyConfig?.state).toBe('ready');
    expect(fyConfig?.next).toBe(nextYear!.name);

    // Run 2: Second full sweep tick — must be idempotent and make zero duplicate creates
    const secondSweep = await runFullSweep(FUNCTIONS_URL, org.orgId);
    expect(secondSweep.status).toBe(200);

    const erpYearsAfter = await benchList(
      'Fiscal Year',
      [['Fiscal Year Company', 'company', '=', company]],
      ['name'],
    );
    // Still exactly 2 years for this company (no duplicates)
    expect(erpYearsAfter.length).toBe(2);

    const { data: intentsAfter } = await admin
      .from('erp_fiscal_year_intents')
      .select('id')
      .eq('org_id', org.orgId);
    expect(intentsAfter?.length).toBe(1);

    const { data: outboxAfter } = await admin
      .from('external_command_outbox')
      .select('id')
      .eq('org_id', org.orgId)
      .eq('domain', 'fiscal_year_setup');
    expect(outboxAfter?.length).toBe(1);
  } finally {
    for (const y of createdYears) {
      await deleteFiscalYearQuiet(y);
    }
    await admin.from('erp_fiscal_year_intents').delete().eq('org_id', org.orgId);
    await admin.from('external_command_outbox').delete().eq('org_id', org.orgId);
    if (company) {
      await dropBenchRun(suffix, company);
    }
    await dropOrg(admin, org);
  }
});

test('AC-ECX-040 served ERPNext fiscal year ensure: disabled fiscal year flags needs-operator and creates no duplicate', async () => {
  const admin = createClient(AUTH_URL, SERVICE_KEY);
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const org = await createOrg(admin, suffix);
  let company: string | undefined;
  const createdYears: string[] = [];

  try {
    company = await createBenchCompany(suffix);

    // Seed current year (2025-12-16 to 2026-12-15)
    const curYearName = `FY-CUR-${suffix}`;
    createdYears.push(curYearName);
    await benchCreate('Fiscal Year', {
      year: curYearName,
      year_start_date: '2025-12-16',
      year_end_date: '2026-12-15',
      companies: [{ company }],
    });

    // Seed a disabled fiscal year for this company covering next span 2026-12-16 to 2027-12-15
    const disYearName = `FY-DIS-${suffix}`;
    createdYears.push(disYearName);
    await benchCreate('Fiscal Year', {
      year: disYearName,
      year_start_date: '2026-12-16',
      year_end_date: '2027-12-15',
      companies: [{ company }],
      disabled: 1,
    });

    // Activate ERPNext binding
    await activateBinding(admin, org.orgId, company, []);

    // Run sweep
    const sweepRes = await runFullSweep(FUNCTIONS_URL, org.orgId);
    expect(sweepRes.status).toBe(200);

    // Verify binding config flags operator action required for disabled year
    const { data: binding } = await admin
      .from('external_org_bindings')
      .select('config')
      .eq('org_id', org.orgId)
      .single();
    const fyConfig = (binding?.config as Record<string, unknown>)?.fiscal_year as Record<string, unknown>;
    expect(fyConfig?.state).toBe('needs-operator');
    expect(fyConfig?.reason).toBe('disabled-year');
    expect(fyConfig?.year).toBe(disYearName);

    // Verify no outbox rows created
    const { data: outbox } = await admin
      .from('external_command_outbox')
      .select('id')
      .eq('org_id', org.orgId)
      .eq('domain', 'fiscal_year_setup');
    expect(outbox?.length ?? 0).toBe(0);
  } finally {
    for (const y of createdYears) {
      await deleteFiscalYearQuiet(y);
    }
    await admin.from('erp_fiscal_year_intents').delete().eq('org_id', org.orgId);
    await admin.from('external_command_outbox').delete().eq('org_id', org.orgId);
    if (company) {
      await dropBenchRun(suffix, company);
    }
    await dropOrg(admin, org);
  }
});

test('AC-ECX-040 served ERPNext fiscal year ensure: restricted role flags needs-operator with missing-role', async () => {
  const admin = createClient(AUTH_URL, SERVICE_KEY);
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const org = await createOrg(admin, suffix);
  let company: string | undefined;
  const restrictedUserEmail = `restricted-${suffix}@pmo-bench.test`;

  try {
    company = await createBenchCompany(suffix);

    // Create restricted user with role Customer
    await benchCreate('User', {
      email: restrictedUserEmail,
      first_name: `Restricted ${suffix}`,
      roles: [{ role: 'Customer' }],
      send_welcome_email: 0,
    });

    // Generate keys for restricted user
    const keyRes = await bench<{ message: { api_key: string; api_secret: string } }>(
      'POST',
      '/api/method/frappe.core.doctype.user.user.generate_keys',
      { user: restrictedUserEmail },
    );
    const restrictedApiKey = keyRes.message.api_key;
    const restrictedApiSecret = keyRes.message.api_secret;

    // Put restricted keys into Vault
    const { data: adminProfile } = await admin
      .from('profiles')
      .select('id')
      .eq('org_id', org.orgId)
      .eq('role', 'Admin')
      .single();
    const secretRef = `restricted-bench-${org.orgId}`;
    const { error: vaultErr } = await admin.rpc('create_vault_secret_for_org', {
      p_org_id: org.orgId,
      p_external_tier: 'erpnext',
      p_secret_value: `${restrictedApiKey}:${restrictedApiSecret}`,
      p_secret_name: secretRef,
      p_actor_id: adminProfile?.id,
    });
    if (vaultErr) throw new Error(`seed Vault secret failed: ${vaultErr.message}`);

    const siteUrl = process.env.ERPNEXT_SITE_URL ?? 'http://host.docker.internal:8080';
    const { error: bindErr } = await admin.from('external_org_bindings').upsert({
      org_id: org.orgId,
      external_tier: 'erpnext',
      site_url: siteUrl,
      secret_ref: secretRef,
      webhook_secret_ref: 'DEMO_ERP_WEBHOOK_SECRET',
      version_major: 15,
      config: { company },
      status: 'active',
      connected_at: new Date().toISOString(),
      activated_at: new Date().toISOString(),
    }, { onConflict: 'org_id,external_tier' });
    if (bindErr) throw new Error(`seed binding failed: ${bindErr.message}`);

    // Run sweep
    const sweepRes = await runFullSweep(FUNCTIONS_URL, org.orgId);
    expect(sweepRes.status).toBe(200);

    // Verify binding config flags operator action required for missing role
    const { data: binding } = await admin
      .from('external_org_bindings')
      .select('config')
      .eq('org_id', org.orgId)
      .single();
    const fyConfig = (binding?.config as Record<string, unknown>)?.fiscal_year as Record<string, unknown>;
    expect(fyConfig?.state).toBe('needs-operator');
    expect(fyConfig?.reason).toBe('missing-role');
  } finally {
    try {
      await bench('DELETE', `/api/resource/User/${encodeURIComponent(restrictedUserEmail)}`);
    } catch {
      // best-effort cleanup
    }
    await admin.from('erp_fiscal_year_intents').delete().eq('org_id', org.orgId);
    await admin.from('external_command_outbox').delete().eq('org_id', org.orgId);
    if (company) {
      await dropBenchRun(suffix, company);
    }
    await dropOrg(admin, org);
  }
});
