/**
 * AC-OCI-001 secondary (layer B, #1506 C2) on the stock Odoo bed: the capability snapshot the real key produces shows every model an invoice
 * and a receipt need, so the employ/dispatch capability check does not wrongly refuse a working connection; and the tax directory the mirror
 * reads carries each sale tax's tax group, which is what tells a PPN output tax from a collector or exempt tax (FR-OCI-023): the effective-11%
 * tax is accepted as the default sales tax and the collector's tax is refused. Gated on the dependency, never on CI: the bed's URL, database and
 * key come from its untracked env file, sourced and never printed. Read-only.
 *   scripts/with-odoo-lock.sh bash -c 'set -a; . ./.env.odoo.local; set +a; ODOO_BED_URL=http://127.0.0.1:$ODOO_PORT \
 *     ODOO_BED_DB=$ODOO_DB ODOO_BED_KEY=$ODOO_API_KEY deno test --allow-env --allow-net --allow-read supabase/functions/adapter-dispatch/odooRevenue.bed.test.ts'
 */
import { assert, assertEquals } from '@std/assert';
import { bindCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { discoverCapabilities } from '../../../pmo-portal/src/lib/adapterSeam/odoo/discovery.ts';
import { KIND_SPECS } from '../../../pmo-portal/src/lib/adapterSeam/odoo/kinds.ts';
import { revenueCapabilityGap } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/capabilities.ts';
import { selectSaleTaxes, type SaleTax } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/taxValidate.ts';

const BED = Deno.env.get('ODOO_BED_URL');
const DB = Deno.env.get('ODOO_BED_DB') ?? '';
const KEY = Deno.env.get('ODOO_BED_KEY') ?? '';

Deno.test({
  name: 'AC-OCI-001 / FR-OCI-023 on the bed: the real snapshot passes the revenue capability check, and the mirrored tax group separates a PPN output tax from a collector tax',
  ignore: !(BED && DB && KEY),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const call = bindCall({ baseUrl: BED!, apiKey: KEY, database: DB, fetchImpl: fetch });
    const snapshot = await discoverCapabilities(call, { versionMajor: 20, now: new Date() });
    assertEquals(revenueCapabilityGap(snapshot), null, `the snapshot shows every revenue model (missing: ${snapshot.missing.join(', ')})`);
    assertEquals(snapshot.models['account.tax'].fields_missing, [], 'the tax group field is readable');

    const spec = KIND_SPECS.tax;
    const rows = await call<Array<Record<string, unknown>>>(spec.model, 'search_read', { domain: [['type_tax_use', '=', 'sale']], fields: [...spec.fields, 'company_id'], limit: 200 });
    const taxes = rows.flatMap((r): SaleTax[] => {
      const parsed = spec.parse(r);
      const company = Array.isArray(r.company_id) ? Number(r.company_id[0]) : NaN;
      return parsed && Number.isFinite(company)
        ? [{ id: Number(parsed.external_id), name: parsed.name, rate: Number(parsed.attrs.amount), active: parsed.active, companyId: company, scope: String(parsed.attrs.use), priceIncluded: parsed.attrs.price_include === true, taxGroup: parsed.attrs.tax_group as string | null }]
        : [];
    });
    assert(taxes.length > 0 && taxes.every((t) => 'taxGroup' in t), 'every parsed tax carries its tax group');
    const effective = taxes.find((t) => t.name === '12% (Non-Luxury Good)' && t.active && !t.priceIncluded);
    assert(effective, 'the stock Indonesian chart has its effective 11% sale tax (V-OCI5)');
    assertEquals(effective.rate, 11);
    assertEquals(selectSaleTaxes({ vatFlag: true, defaultTaxId: effective.id, taxes, companyId: effective.companyId }), { outcome: 'accepted', taxIds: [effective.id] });
    const collector = taxes.find((t) => t.taxGroup === 'Collected by VAT Collector' && t.companyId === effective.companyId);
    assert(collector, 'the chart carries the collector-booked taxes');
    assertEquals(selectSaleTaxes({ vatFlag: true, defaultTaxId: collector.id, taxes, companyId: effective.companyId }), { outcome: 'refused', code: 'config-rejected', tax: collector.name });
  },
});
