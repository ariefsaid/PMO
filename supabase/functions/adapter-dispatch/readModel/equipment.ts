/**
 * The register's read-model writer (#1511 F4; D1/D2). PMO keeps its copy of the register in the shipped Odoo directory mirror
 * (`external_master_records`, 0421/0851), so a confirmed Odoo write converges through the SAME page-apply path the sweep uses:
 *
 *   • a register CREATE also reserves the PMO asset — `record_odoo_asset_created` (0854 §4) writes the mirror row AND the linked
 *     `equipment_assets` row in one transaction, under the id the command reserved, so a replayed finalize is a no-op;
 *   • a register UPDATE and every maintenance write land the mirror row through `apply_odoo_master_rows`. A create carries the
 *     PMO id (the mirror row is derived from it, and the asset's name/archive propagation applies); an update does not claim an id.
 *
 * The row is the one ODOO answered (the adapter read it back), never the request PMO sent: a computed name, Odoo's own write_date.
 */
import { AppError } from '../../../../pmo-portal/src/lib/appError.ts';
import type { ReadModelWriter } from './types.ts';

const REGISTER_KINDS: readonly string[] = ['vehicle', 'equipment'];

export const equipmentWriter: ReadModelWriter = {
  async upsert(ctx, canonical, command) {
    const kind = canonical.kind;
    const row = canonical.row;
    if (typeof kind !== 'string' || !row || typeof row !== 'object' || Array.isArray(row)) {
      throw new AppError('the equipment mirror write has no Odoo row to write', 'commit-rejected');
    }
    const isCreate = command.operation === 'create';
    if (isCreate && REGISTER_KINDS.includes(kind)) {
      const unit = command.record.default_unit;
      const { error } = await ctx.serviceClient.rpc('record_odoo_asset_created', {
        p_org_id: ctx.orgId,
        p_kind: kind,
        p_row: row,
        p_asset_id: command.record.id,
        p_default_unit: typeof unit === 'string' && unit !== '' ? unit : 'hours',
      });
      if (error) throw new AppError(error.message, error.code);
      return;
    }
    const { error } = await ctx.serviceClient.rpc('apply_odoo_master_rows', {
      p_org_id: ctx.orgId,
      p_kind: kind,
      p_rows: [isCreate ? { ...row, pmo_id: command.record.id } : row],
    });
    if (error) throw new AppError(error.message, error.code);
  },
};
