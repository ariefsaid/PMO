import { expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { functions: { invoke: h.invoke } } }));
import { integrationsRepository } from './integrations';

const refusal = (code: string) => ({ context: new Response(JSON.stringify({ error: code, message: 'English line' }), { status: 422 }) });

it('AC-ODC-003 an Odoo connect refusal reaches the card with its code', async () => {
  h.invoke.mockResolvedValue({ data: null, error: refusal('key-rejected') });
  await expect(integrationsRepository.connectIntegration('o', { tier: 'odoo', credential: { siteUrl: 'https://x', database: 'd', apiKey: 'k' } }))
    .rejects.toMatchObject({ code: 'key-rejected' });
});

it('AC-ODC-003 the Odoo connect body carries database, key and expiry; every tier refusal keeps its code', async () => {
  h.invoke.mockResolvedValue({ data: { ok: true, binding: { status: 'active' }, companies: [] }, error: null });
  await integrationsRepository.connectIntegration('o', { tier: 'odoo', credential: { siteUrl: 'https://x', database: 'd', apiKey: 'k', keyExpiresOn: '2027-01-01' } });
  expect(h.invoke).toHaveBeenCalledWith('external-connect', { body: { tier: 'odoo', credential: { siteUrl: 'https://x', database: 'd', apiKey: 'k', keyExpiresOn: '2027-01-01' } } });
  h.invoke.mockResolvedValue({ data: null, error: refusal('NOPE') });
  await expect(integrationsRepository.connectIntegration('o', { tier: 'erpnext', credential: {} })).rejects.toMatchObject({ code: 'NOPE' });
});
