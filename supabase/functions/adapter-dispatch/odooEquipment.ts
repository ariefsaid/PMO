/**
 * The dispatch parts for the fleet and maintenance register (#1511 F4; D5/D7, FR-OFM-030..033): a refusal before any outbox row,
 * and the outbox deps. The adapter itself is `odoo/assets/adapter.ts`; the bodies are `odoo/assets/bodies.ts`.
 *
 * What is refused here, in this order, before the outbox row and before any Odoo write:
 *   1. a command that names no register kind, or another domain's record (the kind→domain check also ran in the auth guard);
 *   2. a cross-org link — the PMO asset a maintenance record hangs off, or the one a register update edits (`asset_id` / `record.id`);
 *   3. an unusable Odoo connection, or a capability snapshot that does not show a model this write needs (named);
 *   4. a register write from a role other than Admin or Project Manager (D7: the asset book is theirs; crews report maintenance);
 *   5. a register CREATE whose PMO asset id the book already holds — the recorder would refuse it at finalize, after the Odoo record
 *      exists and is anchored (an orphan in the register that no PMO row can ever claim);
 *   6. a maintenance record whose PMO asset is not linked to an Odoo asset of the MATCHING kind — a vehicle takes a service log,
 *      equipment takes a maintenance request; a register update whose PMO link and named Odoo record disagree; or a maintenance
 *      UPDATE whose PMO row hangs off a different Odoo asset than the one the command names;
 *   7. an Odoo id the caller named that this org's directory mirror does not hold (a vehicle model, a maintenance stage, a service
 *      type, a vendor) — Odoo would accept any id of the right model, including another Odoo company's row;
 *   8. a body the record cannot produce (a vehicle with no model, a request with no subject, a type Odoo does not know, notes over
 *      the limit).
 *
 * A create is keyed on the PMO record (server-derived) and a probe miss is HELD, never reissued: Odoo has no unique key on these
 * models, so a miss cannot prove the create never landed (D5, ADR-0058 C-1). An update only sets fields, so a lost answer is simply
 * sent again.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Adapter } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import type { DispatchMoneyOutboxDeps } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { bindCall, type OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { ODOO_TIER, toAdapterError } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts';
import { REQUEST_DEADLINE_MS } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/constants.ts';
import { parseOdooExternalRef } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/anchors.ts';
import { createOdooEquipmentAdapter, equipmentKey, type OdooEquipmentCtx } from '../../../pmo-portal/src/lib/adapterSeam/odoo/assets/adapter.ts';
import { buildEquipmentBody } from '../../../pmo-portal/src/lib/adapterSeam/odoo/assets/bodies.ts';
import { equipmentCapabilityGap } from '../../../pmo-portal/src/lib/adapterSeam/odoo/assets/capabilities.ts';
import { ASSET_KIND_SPECS, EQUIPMENT_KIND_DOMAIN, EQUIPMENT_MIRROR_KIND, type AssetKind, type EquipmentCommandKind } from '../../../pmo-portal/src/lib/adapterSeam/odoo/assets/kinds.ts';
import { assertCommandLinksSameOrg, assertLinkBelongsToOrg } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/dispatchPreflight.ts';
import { odooClientForOrg, type OdooClientForOrgResult } from '../_shared/odooClientForOrg.ts';
import { withOdooCallBudget } from '../_shared/odooCallBudget.ts';
import type { AdapterSelectContext } from './dispatchAdapters.ts';
import { createDbMoneyOutboxDeps } from './moneyOutboxDeps.ts';

/** The outbox key a CREATE follows (server-derived): one PMO register or maintenance record is one Odoo record, ever. */
export { equipmentKey };

/** D7: the register is the asset book — Admin and Project Manager only. Every active role records maintenance (the domain role set). */
const REGISTER_ROLES: readonly string[] = ['Admin', 'Project Manager'];

type Resolved = Exclude<OdooClientForOrgResult, { refusal: unknown }>;

/** A mirrored Odoo row of the command's kind, and the Odoo parent PMO holds for it (the asset a maintenance row hangs off). */
interface MirrorTarget { odooId: number; parentExternalId: string | null }

/** A command that names no register kind, or another domain's record, is refused before anything is read. */
function commandShape(ctx: AdapterSelectContext): { kind: EquipmentCommandKind; record: Record<string, unknown>; operation: 'create' | 'update' } {
  const record = ctx.command.record as Record<string, unknown>;
  const kind = record.erp_doc_kind;
  if (typeof kind !== 'string' || !(kind in EQUIPMENT_KIND_DOMAIN)) throw new AppError(`equipment kind '${String(kind)}' is not wired`, 'config-rejected');
  const operation = String(ctx.command.operation);
  if (operation !== 'create' && operation !== 'update') throw new AppError(`equipment does not support ${operation}`, 'config-rejected');
  return { kind: kind as EquipmentCommandKind, record, operation };
}

async function resolveClient(ctx: AdapterSelectContext): Promise<Resolved> {
  const resolved = await odooClientForOrg(ctx.serviceClient as SupabaseClient, ctx.orgId);
  if ('refusal' in resolved) throw new AppError(`The Odoo connection is not usable (${resolved.refusal})`, 'config-rejected');
  return resolved;
}

/** The caller's CURRENT role in this org, read from DB truth (the same RPC the dispatch guard uses) — never from the payload. */
async function actorRole(ctx: AdapterSelectContext): Promise<string | null> {
  const { data, error } = await (ctx.serviceClient as SupabaseClient).rpc('actor_authorization_state', {
    p_org_id: ctx.orgId, p_user_id: ctx.userId,
  });
  const state = data as { role?: unknown; active?: unknown } | null;
  if (error || !state || state.active !== true) throw new AppError('register-role', 'commit-rejected');
  return typeof state.role === 'string' ? state.role : null;
}

/**
 * The Odoo id inside a PMO asset's link (`equipment_assets.external_ref` is `<mirror kind>:<odoo id>`, D2 — the mirror's own
 * vocabulary, never an Odoo model name), or null when the link is absent or names the OTHER kind.
 */
function linkedOdooId(ref: string | null, mirrorKind: string): number | null {
  if (ref === null || !ref.startsWith(`${mirrorKind}:`)) return null;
  const rest = ref.slice(mirrorKind.length + 1);
  return /^[1-9][0-9]*$/.test(rest) ? Number(rest) : null;
}

/** The Odoo ref a PMO asset is linked to, in the caller's org; `null` when it carries none. */
async function linkedRef(ctx: AdapterSelectContext, assetId: string): Promise<string | null> {
  const { data, error } = await (ctx.serviceClient as SupabaseClient).from('equipment_assets')
    .select('external_ref').eq('org_id', ctx.orgId).eq('id', assetId).maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  const ref = (data as { external_ref?: unknown } | null)?.external_ref;
  return typeof ref === 'string' && ref !== '' ? ref : null;
}

/**
 * An update names an Odoo record PMO already holds: the ref must be that kind's model, and a mirror row of that kind must exist in
 * the caller's org. Without this a caller could name ANY record id of the right model in the org's Odoo — including one PMO's view
 * does not point at. The row's own parent is returned with it: a maintenance row hangs off the Odoo asset PMO mirrored it under.
 */
async function assertMirrorRow(ctx: AdapterSelectContext, kind: EquipmentCommandKind, externalId: unknown): Promise<MirrorTarget> {
  const spec = ASSET_KIND_SPECS[EQUIPMENT_MIRROR_KIND[kind]];
  const odooId = parseOdooExternalRef(spec.model, externalId);
  if (odooId === null) throw new AppError('equipment-not-linked', 'commit-rejected');
  const { data, error } = await (ctx.serviceClient as SupabaseClient).from('external_master_records')
    .select('id,parent_external_id').eq('org_id', ctx.orgId).eq('external_tier', ODOO_TIER)
    .eq('kind', EQUIPMENT_MIRROR_KIND[kind]).eq('external_id', String(odooId)).maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  if (!data) throw new AppError('equipment-not-linked', 'commit-rejected');
  const parent = (data as { parent_external_id?: unknown }).parent_external_id;
  return { odooId, parentExternalId: typeof parent === 'string' && parent !== '' ? parent : null };
}

/**
 * A register CREATE reserves the PMO asset id the command carries. The recorder (`record_odoo_asset_created`, 0854 §4) writes the
 * asset under exactly that id and refuses one that is already taken — but only AT FINALIZE, after the Odoo record exists and its
 * anchor is written, which leaves an orphan in the register and a command that never finishes. So the book is asked first: an id it
 * already holds (this org's, or another's — the id is the command's identity) refuses here, before the outbox row.
 */
async function assertFreshAssetId(ctx: AdapterSelectContext, record: Record<string, unknown>): Promise<void> {
  const { data, error } = await (ctx.serviceClient as SupabaseClient).from('equipment_assets')
    .select('id').eq('id', String(record.id)).maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  if (data) throw new AppError('record-id-invalid', 'commit-rejected');
}

/** The mirror kind a named id must land under: one of the fleet/maintenance kinds (the sweep's `assets` block) or a party. */
type NamedMirrorKind = AssetKind | 'partner';

/**
 * The Odoo ids a body NAMES that the CALLER chose: a vehicle model, a maintenance stage, a service type, a vendor. Odoo would accept
 * any id of the right model — including a row of another Odoo company — while this org's directory mirror holds exactly the rows PMO
 * shows, so an id outside it is refused before the outbox. An absent field is not checked (an UPDATE may leave it out); an id too
 * malformed to be an Odoo id is left to the body builder, which names it.
 */
const PAYLOAD_ID_MIRROR: Readonly<Record<EquipmentCommandKind, ReadonlyArray<{ field: string; kind: NamedMirrorKind; code: string }>>> = {
  'register-vehicle': [{ field: 'model_id', kind: 'vehicle_model', code: 'vehicle-model-invalid' }],
  'register-equipment': [],
  'maintenance-request': [{ field: 'stage_id', kind: 'maintenance_stage', code: 'stage-invalid' }],
  'vehicle-service': [
    { field: 'service_type_id', kind: 'service_type', code: 'service-type-invalid' },
    { field: 'vendor_id', kind: 'partner', code: 'vendor-invalid' },
  ],
};

async function assertPayloadIdsMirrored(ctx: AdapterSelectContext, kind: EquipmentCommandKind, record: Record<string, unknown>): Promise<void> {
  for (const named of PAYLOAD_ID_MIRROR[kind]) {
    const raw = record[named.field];
    if (raw === undefined || raw === null) continue;
    const odooId = Number(raw);
    if (!Number.isInteger(odooId) || odooId <= 0) continue;
    const { data, error } = await (ctx.serviceClient as SupabaseClient).from('external_master_records')
      .select('id').eq('org_id', ctx.orgId).eq('external_tier', ODOO_TIER)
      .eq('kind', named.kind).eq('external_id', String(odooId)).maybeSingle();
    if (error) throw new AppError(error.message, error.code);
    if (!data) throw new AppError(named.code, 'commit-rejected');
  }
}

/** A register update also edits the PMO asset that record is linked to: this org's row, linked to exactly that Odoo record. */
async function assertRegisterUpdateTarget(ctx: AdapterSelectContext, target: MirrorTarget, record: Record<string, unknown>, kind: EquipmentCommandKind): Promise<void> {
  const assetId = String(record.id);
  await assertLinkBelongsToOrg(ctx.serviceClient as never, ctx.orgId, 'equipment_assets', assetId);
  if (linkedOdooId(await linkedRef(ctx, assetId), EQUIPMENT_MIRROR_KIND[kind]) !== target.odooId) {
    throw new AppError('equipment-not-linked', 'commit-rejected');
  }
}

/**
 * What the body builder needs, resolved from DB truth: the Odoo company every create belongs to, and (for maintenance) the Odoo
 * asset the record hangs off. A maintenance record for a PMO asset that is not linked, or is linked to the OTHER kind, is refused
 * here — before the outbox — so no Odoo write can name a document PMO's own view does not point at. An update additionally names a
 * record PMO already mirrors, and (for a register) the PMO asset that record is linked to; a maintenance UPDATE must also hang off
 * the SAME Odoo asset the command names, because the body never resends the parent — without that the pair proves nothing.
 */
async function bodyContext(
  ctx: AdapterSelectContext,
  kind: EquipmentCommandKind,
  record: Record<string, unknown>,
  operation: 'create' | 'update',
  companyId: number,
): Promise<OdooEquipmentCtx> {
  const target = operation === 'update' ? await assertMirrorRow(ctx, kind, record.external_id) : null;
  if (target !== null && (kind === 'register-vehicle' || kind === 'register-equipment')) {
    await assertRegisterUpdateTarget(ctx, target, record, kind);
  }
  if (kind === 'maintenance-request' || kind === 'vehicle-service') {
    const assetId = record.asset_id;
    if (typeof assetId !== 'string' || assetId === '') throw new AppError('equipment-not-linked', 'commit-rejected');
    const ref = await linkedRef(ctx, assetId);
    if (ref === null) throw new AppError('equipment-not-linked', 'commit-rejected');
    const expected = kind === 'maintenance-request' ? 'equipment' : 'vehicle';
    const odooId = linkedOdooId(ref, expected);
    if (odooId === null) throw new AppError('equipment-kind-mismatch', 'commit-rejected');
    if (target !== null && target.parentExternalId !== String(odooId)) throw new AppError('equipment-not-linked', 'commit-rejected');
    return kind === 'maintenance-request' ? { companyId, odooEquipmentId: odooId } : { companyId, odooVehicleId: odooId };
  }
  return { companyId };
}

interface ResolvedWrite {
  kind: EquipmentCommandKind;
  record: Record<string, unknown>;
  operation: 'create' | 'update';
  bodyCtx: OdooEquipmentCtx;
  resolved: Resolved;
}

/** The whole pre-flight both the adapter factory and the outbox deps run: shape, connection, capability, role, id, links, dry build. */
async function resolveWriteOnce(ctx: AdapterSelectContext): Promise<ResolvedWrite> {
  const { kind, record, operation } = commandShape(ctx);
  // The shared same-org link check (AC-OPP-003's pre-flight): a maintenance record's `asset_id` must be this org's row.
  await assertCommandLinksSameOrg({ command: ctx.command, serviceClient: ctx.serviceClient as never, orgId: ctx.orgId });
  const resolved = await resolveClient(ctx);
  const gap = equipmentCapabilityGap(resolved.config.capabilities as Parameters<typeof equipmentCapabilityGap>[0]);
  if (gap) throw new AppError(`Odoo equipment needs ${gap}, which this Odoo connection does not show. Run the connection check again.`, 'config-rejected');
  if (kind.startsWith('register-') && !REGISTER_ROLES.includes((await actorRole(ctx)) ?? '')) {
    throw new AppError('register-role', 'commit-rejected');
  }
  // After the role gate (a caller who may not keep the book learns nothing about it) and before the outbox row.
  if (kind.startsWith('register-') && operation === 'create') await assertFreshAssetId(ctx, record);
  const bodyCtx = await bodyContext(ctx, kind, record, operation, resolved.companyId as number);
  await assertPayloadIdsMirrored(ctx, kind, record);
  const built = buildEquipmentBody(kind, record, { ...bodyCtx, operation });
  if (built.outcome === 'refused') throw new AppError(built.code, 'config-rejected');
  return { kind, record, operation, bodyCtx, resolved };
}

/**
 * One dispatch resolves the same command's pre-flight TWICE — the adapter factory and the outbox deps both need it — milliseconds
 * apart, and the second answer is the first one's: the same connection, the same role, the same links. The command object lives for
 * exactly one dispatch, so it keys the answer (weakly, so a finished request leaves nothing behind). A refusal is cached with it:
 * the first one already ended the dispatch, and the second caller must see the same reason rather than a differently-timed read.
 */
const PREFLIGHT = new WeakMap<object, Promise<ResolvedWrite>>();

function resolveWrite(ctx: AdapterSelectContext): Promise<ResolvedWrite> {
  const key = ctx.command as unknown as object;
  const cached = PREFLIGHT.get(key);
  if (cached) return cached;
  const pending = resolveWriteOnce(ctx);
  PREFLIGHT.set(key, pending);
  return pending;
}

/** The Odoo adapter for one register or maintenance command; every refusal above happens before it is returned. */
export async function resolveOdooEquipmentAdapter(ctx: AdapterSelectContext): Promise<Adapter> {
  const { bodyCtx, resolved } = await resolveWrite(ctx);
  const call = bindCall({ ...resolved.client, deadlineMs: REQUEST_DEADLINE_MS });
  return createOdooEquipmentAdapter({ call, ctx: bodyCtx });
}

/**
 * The DB-backed outbox deps for ONE register or maintenance command: the shared outbox, claim, fence and finalize, with the anchor
 * probe as the create's recovery. A create's probe miss is HELD (`reissueOnInconclusiveAbsence: false`); an update is a plain
 * field write and is sent again.
 */
export async function resolveOdooEquipmentMoneyOutboxDeps(ctx: AdapterSelectContext): Promise<DispatchMoneyOutboxDeps> {
  const { record, operation, bodyCtx, resolved } = await resolveWrite(ctx);
  const raw = withOdooCallBudget(bindCall({ ...resolved.client, deadlineMs: REQUEST_DEADLINE_MS }), ctx.odooCallBudget);
  const call: OdooCall = async <T>(model: string, method: string, body?: Record<string, unknown>) => {
    try { return await raw<T>(model, method, body); } catch (err) { return toAdapterError(err); }
  };
  const adapter = createOdooEquipmentAdapter({ call, ctx: bodyCtx });
  return createDbMoneyOutboxDeps({
    serviceClient: ctx.serviceClient as never,
    orgId: ctx.orgId,
    externalTier: ODOO_TIER,
    operation,
    actorUserId: ctx.userId,
    reissueOnInconclusiveAbsence: operation === 'update',
    probeByRemarksKey: operation === 'create'
      ? async () => {
        const hit = await adapter.probe(record);
        return hit ? { externalRecordId: hit.externalRecordId, canonical: hit.canonical } : null;
      }
      : async () => null,
  });
}
