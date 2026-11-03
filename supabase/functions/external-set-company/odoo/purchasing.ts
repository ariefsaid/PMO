/**
 * Odoo purchasing setup verbs (#1505 P2): employ procurement under Odoo (FR-OPP-001, PQ-12 parity with ERPNext's `employ-domain`)
 * and the org's default payment journal (FR-OPP-093, OQ-OPP-6). Odoo is not called: the journal list is the O1 mirror, and the
 * writes go through the actor-checked RPCs (0505, 0509), which decide who may employ and which journals qualify.
 */
import { odooError, type OdooCtx } from './router.ts';

const JOURNAL_TYPES = new Set(['bank', 'cash']);

export async function employDomain(c: OdooCtx): Promise<Response> {
  if (c.body.domain !== 'procurement') return odooError(c, 'Choose a supported ERP domain', 'BAD_REQUEST', 400);
  const { error } = await c.sc.rpc('admin_change_domain_ownership', {
    p_org_id: c.orgId, p_external_tier: 'odoo', p_domain: 'procurement', p_action: 'employ', p_actor_id: c.userId,
  });
  if (!error) return c.respond({ ok: true });
  if (error.code === '42501') return odooError(c, 'Not allowed for your role', 'FORBIDDEN', 403);
  if (error.code === 'P0001') {
    // The refusals are the database's plain words (0505). A model the stored snapshot lacks is usually an old snapshot.
    const hint = /^Odoo is missing /.test(error.message) ? `${error.message}. Check the connection again, then retry.` : error.message;
    return odooError(c, hint, 'config-rejected', 422);
  }
  return odooError(c, 'The request could not be completed', 'STORE_FAILED', 500);
}

interface Journal { id: string; code: string; name: string; type: string }

async function journals(c: OdooCtx): Promise<Journal[] | null> {
  const { data, error } = await c.sc.from('external_master_records').select('external_id, code, name, attrs')
    .eq('org_id', c.orgId).eq('external_tier', 'odoo').eq('kind', 'journal').eq('active', true).is('tombstoned_at', null).order('external_id');
  if (error) return null;
  return (data ?? []).flatMap((r) => {
    const type = (r.attrs as { type?: unknown } | null)?.type;
    return typeof type === 'string' && JOURNAL_TYPES.has(type) ? [{ id: r.external_id as string, code: (r.code as string | null) ?? '', name: r.name as string, type }] : [];
  });
}

/** What the setup page offers for the payment journal: the one bank journal, a choice, or nothing; plus any default already set. */
export async function proposeConfig(c: OdooCtx): Promise<Response> {
  const [list, binding] = await Promise.all([
    journals(c),
    c.sc.from('external_org_bindings').select('config').eq('org_id', c.orgId).eq('external_tier', 'odoo').maybeSingle(),
  ]);
  if (list === null || binding.error || !binding.data) return odooError(c, 'The journals could not be read', 'STORE_FAILED', 500);
  const set = (binding.data.config as Record<string, unknown> | null)?.default_payment_journal_id;
  const current = list.find((j) => j.id === String(set)) ?? null;
  const pick = (j: Journal) => ({ id: j.id, code: j.code, name: j.name });
  const banks = list.filter((j) => j.type === 'bank');
  if (current) return c.respond({ journal: { state: 'set', current: pick(current), candidates: list } });
  if (banks.length === 1) return c.respond({ journal: { state: 'proposed', proposed: pick(banks[0]), candidates: list, current: null } });
  return c.respond({ journal: { state: list.length ? 'choose' : 'none', candidates: list, current: null } });
}

/** Saves the chosen default payment journal. ponytail: journal only; O1-S7 adds account and unit defaults to this same verb. */
export async function saveDefaults(c: OdooCtx): Promise<Response> {
  const id = c.body.default_payment_journal_id;
  const text = typeof id === 'number' && Number.isInteger(id) ? String(id) : id;
  if (typeof text !== 'string' || !/^[0-9]{1,9}$/.test(text)) return odooError(c, 'default_payment_journal_id is required', 'BAD_REQUEST', 400);
  const { error } = await c.sc.rpc('set_odoo_payment_journal_default', { p_org_id: c.orgId, p_actor_id: c.userId, p_journal_id: text });
  if (!error) return c.respond({ saved: true });
  if (error.code === '42501') return odooError(c, 'Not allowed for your role', 'FORBIDDEN', 403);
  if (error.code === 'P0001') return odooError(c, error.message, 'REFUSED', 409);
  return odooError(c, 'The request could not be completed', 'STORE_FAILED', 500);
}
