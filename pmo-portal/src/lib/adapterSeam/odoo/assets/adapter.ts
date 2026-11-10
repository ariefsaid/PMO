/**
 * The Odoo `Adapter` (contract.ts) for the fleet and maintenance register (#1511 F4; D5/D6). PMO is the only interface a user has
 * to the register, so a save in PMO is a create or a field write in Odoo — through the shipped outbox, never around it.
 *
 * Every create is keyed on the PMO record id (`equipment:<uuid>`, derived by the server) and anchored with a stock external
 * identifier (`ir.model.data`, module `pmo`) written right after the create, exactly as a purchase order is. The identifier is what
 * makes a lost answer recoverable: the outbox's recovery probe finds the anchored record and adopts it instead of creating a
 * second one. Odoo has no unique key on these models, so a probe that finds nothing cannot prove the create never landed — the
 * outbox holds such a command for a person (never reissues it). An update only sets fields, so it is simply sent again.
 *
 * The read-back is not decoration: PMO mirrors what ODOO holds (a computed vehicle name, Odoo's own write_date), never what PMO
 * sent. A record that cannot be read back is refused, never mirrored from the request.
 */
import { AdapterError, type Adapter, type AdapterCommand, type CommandResult, type PmoRecord } from '../../contract.ts';
import type { DirectoryRow, KindSpec } from '../kinds.ts';
import type { OdooCall } from '../client.ts';
import { ODOO_TIER, toAdapterError } from '../connectAdapter.ts';
import { externalIdentifier, odooExternalRef, parseOdooExternalRef } from '../purchase/anchors.ts';
import { buildEquipmentBody } from './bodies.ts';
import { ASSET_KIND_SPECS, EQUIPMENT_DOMAIN, EQUIPMENT_KIND_DOMAIN, EQUIPMENT_MIRROR_KIND, type AssetKind, type EquipmentCommandKind } from './kinds.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Odoo company a create belongs to, and the linked ids a maintenance record hangs off (resolved by the dispatch, never the client). */
export interface OdooEquipmentCtx {
  companyId: number;
  odooEquipmentId?: number;
  odooVehicleId?: number;
}

export interface OdooEquipmentDeps {
  call: OdooCall;
  ctx: OdooEquipmentCtx;
}

/** The recovery probe's answer: the anchored record's ref and the mirror row Odoo holds for it. */
export interface EquipmentProbeHit {
  externalRecordId: string;
  canonical: PmoRecord;
}

const refuse = (reason: string): never => { throw new AdapterError('commit-rejected', reason); };

/** Odoo failures become contract errors (transient vs rejected); the message is the class, never Odoo's text. */
const guarded = (call: OdooCall): OdooCall => async (model, method, body) => {
  try { return await call(model, method, body); } catch (err) { return toAdapterError(err); }
};

/**
 * One PMO register or maintenance record is one anchored Odoo record, ever: the outbox key follows the record, and a record id
 * that is not a UUID refuses before any outbox row or Odoo request.
 */
export function equipmentKey(record: Record<string, unknown>): string {
  const id = String(record.id);
  if (!UUID.test(id)) throw new AdapterError('commit-rejected', 'record-id-invalid');
  return `equipment:${id.toLowerCase()}`;
}

const MODEL_KIND: Readonly<Record<string, AssetKind>> = Object.fromEntries(
  Object.entries(ASSET_KIND_SPECS).map(([kind, spec]) => [spec.model, kind as AssetKind]),
);

function kindOf(record: Record<string, unknown>): EquipmentCommandKind {
  const kind = record.erp_doc_kind;
  if (typeof kind !== 'string' || !(kind in EQUIPMENT_KIND_DOMAIN)) refuse(`unsupported equipment kind ${String(kind)}`);
  return kind as EquipmentCommandKind;
}

const specOf = (kind: EquipmentCommandKind): KindSpec => ASSET_KIND_SPECS[EQUIPMENT_MIRROR_KIND[kind]];

/** The canonical record the mirror writes: the command's PMO id, the mirror kind, and the row Odoo itself answered. */
const canonicalOfRow = (pmoId: unknown, mirrorKind: AssetKind, row: DirectoryRow): PmoRecord =>
  ({ id: String(pmoId), kind: mirrorKind, row });
const canonicalOf = (pmoId: unknown, kind: EquipmentCommandKind, row: DirectoryRow): PmoRecord =>
  canonicalOfRow(pmoId, EQUIPMENT_MIRROR_KIND[kind], row);

export interface OdooEquipmentAdapter extends Adapter {
  /** Has this PMO record already landed in Odoo? The outbox's create-recovery probe (held when it finds nothing). */
  probe(record: Record<string, unknown>): Promise<EquipmentProbeHit | null>;
}

export function createOdooEquipmentAdapter({ call: rawCall, ctx }: OdooEquipmentDeps): OdooEquipmentAdapter {
  const call = guarded(rawCall);

  /** The `ir.model.data` row this key names, or null. The name is unique on (module, name) in Odoo, so an anchor of this key that
   *  names ANOTHER model is doubt: writing a second identifier would fail there and, worse, could point one PMO record at two
   *  Odoo documents. It is refused, never overwritten. */
  const anchoredId = async (key: string, model: string): Promise<number | null> => {
    const { name } = externalIdentifier(key);
    const rows = await call<Array<{ model: string; res_id: number }>>('ir.model.data', 'search_read', {
      domain: [['module', '=', 'pmo'], ['name', '=', name]], fields: ['model', 'res_id'], limit: 2,
    });
    if (rows.length > 1) refuse('ambiguous-anchor');
    if (rows.length === 0) return null;
    if (rows[0].model !== model) refuse('ambiguous-anchor');
    return rows[0].res_id;
  };

  const writeAnchor = async (key: string, model: string, id: number): Promise<void> => {
    const { module, name } = externalIdentifier(key);
    await call('ir.model.data', 'create', { vals_list: [{ module, name, model, res_id: id }] });
  };

  const readRow = async (spec: KindSpec, id: number): Promise<DirectoryRow | null> => {
    const rows = await call<Record<string, unknown>[]>(spec.model, 'search_read', {
      domain: [['id', '=', id]], fields: spec.fields, limit: 1, context: { active_test: false },
    });
    const raw = rows[0];
    return raw && typeof raw === 'object' ? spec.parse(raw) : null;
  };

  /** The mirror row Odoo holds for one id; a record Odoo will not answer is refused, never mirrored from the request. */
  const readBack = async (kind: EquipmentCommandKind, id: number): Promise<DirectoryRow> => {
    const row = await readRow(specOf(kind), id);
    return row ?? refuse('unreadable-after-write');
  };

  const bodyOf = (kind: EquipmentCommandKind, record: Record<string, unknown>, operation: 'create' | 'update'): Record<string, unknown> => {
    const built = buildEquipmentBody(kind, record, { ...ctx, operation });
    return built.outcome === 'ready' ? built.body : refuse(built.code);
  };

  const probe = async (record: Record<string, unknown>): Promise<EquipmentProbeHit | null> => {
    const kind = kindOf(record);
    const spec = specOf(kind);
    const id = await anchoredId(equipmentKey(record), spec.model);
    if (id === null) return null;
    return { externalRecordId: odooExternalRef(spec.model, id), canonical: canonicalOf(record.id, kind, await readBack(kind, id)) };
  };

  return {
    tier: ODOO_TIER,
    capabilityMap: new Set([EQUIPMENT_DOMAIN]),

    async commit(cmd: AdapterCommand): Promise<CommandResult> {
      if (cmd.domain !== EQUIPMENT_DOMAIN) refuse(`unsupported domain ${cmd.domain}`);
      const record = cmd.record as Record<string, unknown>;
      const kind = kindOf(record);
      const spec = specOf(kind);

      if (cmd.operation === 'create') {
        const key = equipmentKey(record);
        const anchored = await anchoredId(key, spec.model);
        // A retry of a create that already landed (a lost answer) adopts the anchored record: never a second document.
        if (anchored !== null) return { externalRecordId: odooExternalRef(spec.model, anchored), canonical: canonicalOf(record.id, kind, await readBack(kind, anchored)) };
        const id = (await call<number[]>(spec.model, 'create', { vals_list: [bodyOf(kind, record, 'create')] }))[0];
        if (!Number.isInteger(id) || id <= 0) refuse('create-unreadable');
        await writeAnchor(key, spec.model, id);
        return { externalRecordId: odooExternalRef(spec.model, id), canonical: canonicalOf(record.id, kind, await readBack(kind, id)) };
      }

      if (cmd.operation === 'update') {
        const id = parseOdooExternalRef(spec.model, record.external_id) ?? refuse('external-id-invalid');
        await call(spec.model, 'write', { ids: [id], vals: bodyOf(kind, record, 'update') });
        return { externalRecordId: odooExternalRef(spec.model, id), canonical: canonicalOf(record.id, kind, await readBack(kind, id)) };
      }

      return refuse(`unsupported operation ${cmd.operation}`);
    },

    probe,

    async getByExternalId(domain, externalRecordId) {
      if (domain !== EQUIPMENT_DOMAIN) refuse(`unsupported domain ${domain}`);
      const model = externalRecordId.includes(':') ? externalRecordId.slice(0, externalRecordId.lastIndexOf(':')) : '';
      const kind = MODEL_KIND[model];
      if (!kind) refuse('external-id-invalid');
      const id = parseOdooExternalRef(model, externalRecordId);
      if (id === null) return null;
      const row = await readRow(ASSET_KIND_SPECS[kind], id);
      return row ? canonicalOfRow(externalRecordId, kind, row) : null;
    },

    // The register is mirrored by the odoo-sweep's own readers (`readModel/equipment.ts` and `assets/kinds.ts`), not by an adapter
    // read: an unsupported read refuses rather than answering an empty page that a caller could take for "nothing changed".
    async listChangesSinceWatermark(domain) {
      if (domain !== EQUIPMENT_DOMAIN) refuse(`unsupported domain ${domain}`);
      return refuse('register-feed-is-the-sweep');
    },
  };
}
