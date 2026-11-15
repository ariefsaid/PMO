import type { SupabaseClient } from '@supabase/supabase-js';
import type { CaptureAdapter } from '../../../pmo-portal/src/lib/adapterSeam/captureAdapter.ts';
import { createCaptureAdapter as createErpnextCaptureAdapter } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/captureAdapter.ts';
import { createCaptureAdapter as createOdooCaptureAdapter } from '../../../pmo-portal/src/lib/adapterSeam/odoo/captureAdapter.ts';
import { erpClientForOrg } from './erpClientForOrg.ts';

type Options = { erpCalls?: boolean };
type Factory = (service: SupabaseClient, orgId: string, config: { company?: unknown } | null, options: Options) => Promise<CaptureAdapter>;
const factories: Record<string, Factory> = {
  erpnext: (service, orgId, config, options) => createErpnextCaptureAdapter(config, () => erpClientForOrg(service, orgId, { requireCompany: true }), options),
  odoo: () => createOdooCaptureAdapter(),
};
export async function captureAdapterForOrg(tier: string, service: SupabaseClient, orgId: string, config: { company?: unknown } | null, options: Options = {}): Promise<CaptureAdapter> {
  const factory = Object.hasOwn(factories, tier) ? factories[tier] : undefined;
  return factory ? await factory(service, orgId, config, options) : { supported: false, missing: ['unsupported_adapter'], status: 409 };
}
