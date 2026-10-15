import { expectTypeOf, it } from 'vitest';
import type { Database, Tables } from '../supabase/database.types';

it('AC-PFIN-010 generated schema exposes invoice provenance and the attribution RPC', () => {
  expectTypeOf<Tables<'sales_invoices'>['erp_project']>().toEqualTypeOf<string | null>();
  expectTypeOf<Database['public']['Functions']['assign_sales_invoice_project']['Args']>()
    .toEqualTypeOf<{ p_si_id: string; p_project_id: string }>();
});
