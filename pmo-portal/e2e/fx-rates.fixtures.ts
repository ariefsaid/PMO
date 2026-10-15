import type { SupabaseClient } from '@supabase/supabase-js';

export interface FxFixture {
  orgId: string;
  financeId: string;
  email: string;
  password: string;
  companyId: string;
  projectId: string;
  invoiceId: string;
}

function fail(step: string, error: { message: string } | null): void {
  if (error) throw new Error(`AC-FX-015 fixture ${step}: ${error.message}`);
}

export async function removeFxFixture(admin: SupabaseClient, fixture: FxFixture): Promise<void> {
  const failures: string[] = [];
  const attempt = async (
    step: string,
    operation: () => PromiseLike<{ error: { message: string } | null }>,
  ) => {
    try {
      const { error } = await operation();
      if (error) failures.push(`${step}: ${error.message}`);
    } catch (error) {
      failures.push(`${step}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  try {
    if (fixture.invoiceId) {
      await attempt('remove invoice authors', () =>
        admin.from('sales_invoice_authors').delete().eq('sales_invoice_id', fixture.invoiceId),
      );
      await attempt('remove invoice', () =>
        admin.from('sales_invoices').delete().eq('id', fixture.invoiceId),
      );
    }
    if (fixture.orgId)
      await attempt('remove FX rates', () =>
        admin.from('fx_rates').delete().eq('org_id', fixture.orgId),
      );
    if (fixture.projectId)
      await attempt('remove project', () =>
        admin.from('projects').delete().eq('id', fixture.projectId),
      );
    if (fixture.companyId)
      await attempt('remove company', () =>
        admin.from('companies').delete().eq('id', fixture.companyId),
      );
    if (fixture.financeId) {
      await attempt('remove profile', () =>
        admin.from('profiles').delete().eq('id', fixture.financeId),
      );
      await attempt('remove Finance user', () => admin.auth.admin.deleteUser(fixture.financeId));
    }
    if (fixture.orgId)
      await attempt('remove organization', () =>
        admin.from('organizations').delete().eq('id', fixture.orgId),
      );
  } finally {
    fixture.email = '';
    fixture.password = '';
  }
  if (failures.length > 0) throw new Error(`AC-FX-015 cleanup failed: ${failures.join('; ')}`);
}

/** Provision one independent tenant and its read-only USD documents for AC-FX-015. */
export async function createFxFixture(admin: SupabaseClient): Promise<FxFixture> {
  const suffix = crypto.randomUUID();
  const fixture: FxFixture = {
    orgId: crypto.randomUUID(),
    financeId: '',
    email: `fx-${suffix}@example.invalid`,
    password: `${crypto.randomUUID()}-Aa1!`,
    companyId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    invoiceId: crypto.randomUUID(),
  };

  try {
    fail(
      'create organization',
      (
        await admin.from('organizations').insert({
          id: fixture.orgId,
          name: `AC-FX-015 ${suffix}`,
          default_currency: 'IDR',
          default_timezone: 'Asia/Jakarta',
          lifecycle_state: 'test',
        })
      ).error,
    );

    const created = await admin.auth.admin.createUser({
      email: fixture.email,
      password: fixture.password,
      email_confirm: true,
    });
    if (created.data.user) fixture.financeId = created.data.user.id;
    if (created.error || !created.data.user)
      throw new Error(
        `AC-FX-015 fixture create Finance user: ${created.error?.message ?? 'no user returned'}`,
      );

    fail(
      'create Finance profile',
      (
        await admin.from('profiles').upsert(
          {
            id: fixture.financeId,
            org_id: fixture.orgId,
            email: fixture.email,
            full_name: `FX Finance ${suffix.slice(0, 8)}`,
            role: 'Finance',
            status: 'active',
          },
          { onConflict: 'id' },
        )
      ).error,
    );

    fail(
      'create Client company',
      (
        await admin.from('companies').insert({
          id: fixture.companyId,
          org_id: fixture.orgId,
          name: `FX Client ${suffix.slice(0, 8)}`,
          type: 'Client',
        })
      ).error,
    );

    fail(
      'create USD project',
      (
        await admin.from('projects').insert({
          id: fixture.projectId,
          org_id: fixture.orgId,
          code: `FX-${suffix.slice(0, 8)}`,
          name: `FX Project ${suffix.slice(0, 8)}`,
          status: 'Ongoing Project',
          client_id: fixture.companyId,
          currency: 'USD',
          contract_value: 100,
          contract_date: '2026-10-10',
          subject_to_vat: false,
          tax_treatment: 'exclusive',
          tax_amount: 0,
        })
      ).error,
    );

    fail(
      'create read-only USD invoice',
      (
        await admin.from('sales_invoices').insert({
          id: fixture.invoiceId,
          org_id: fixture.orgId,
          project_id: fixture.projectId,
          customer_id: fixture.companyId,
          currency: 'USD',
          amount: 100,
          tax_amount: 0,
          tax_treatment: 'exclusive',
          invoice_date: '2026-10-12',
          status: 'Unpaid',
          erp_docstatus: 1,
          erp_outstanding_amount: 25,
          pmo_native: false,
        })
      ).error,
    );

    return fixture;
  } catch (error) {
    try {
      await removeFxFixture(admin, fixture);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'AC-FX-015 fixture setup and partial cleanup failed',
        { cause: cleanupError },
      );
    }
    throw error;
  }
}
