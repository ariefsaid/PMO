import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => {
  const selects: string[] = [];
  const chain = { eq: () => chain, maybeSingle: async () => ({ data: null, error: null }), then: (r: (v: unknown) => unknown) => r({ data: [], error: null }) };
  return {
    selects,
    invoke: vi.fn(async () => ({ data: { ok: true }, error: null })),
    from: vi.fn(() => ({ select: (cols: string) => { selects.push(cols); return chain; } })),
  };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, functions: { invoke: h.invoke } } }));
import { repositories } from './index';
import { erpSetupRequest } from './integrations';

beforeEach(() => { vi.clearAllMocks(); h.selects.length = 0; });

it('AC-ODC-009 the browser never asks for the secret reference column', async () => {
  await repositories.integrations.getBinding('org-1', 'odoo');
  await repositories.integrations.listBindings('org-1');
  expect(h.from).toHaveBeenCalledWith('external_org_bindings');
  expect(h.selects).toHaveLength(2);
  for (const cols of h.selects) {
    expect(cols).toContain('status');
    expect(cols).not.toMatch(/secret_ref/);
  }
});

it('PQ-12 setup requests carry the tier, defaulting to erpnext', async () => {
  await erpSetupRequest('list-companies', {}, 'odoo');
  await erpSetupRequest('readiness');
  expect(h.invoke).toHaveBeenNthCalledWith(1, 'external-set-company', { body: { tier: 'odoo', setupAction: 'list-companies' } });
  expect(h.invoke).toHaveBeenNthCalledWith(2, 'external-set-company', { body: { tier: 'erpnext', setupAction: 'readiness' } });
});
