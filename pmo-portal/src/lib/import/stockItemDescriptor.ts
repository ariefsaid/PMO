import type { TFunction } from 'i18next';
import { repositories } from '@/src/lib/repositories';
import type { StockItemInput, StockWarehouseInput } from '@/src/lib/db/stockMaster';
import type { ImportDescriptor } from './types';
import { makeRefLookup, refId, refValidate } from './refLookup';
import { keyedAlready, labelOf, makeField, requiredText } from './importShared';

type Cells = Record<string, string>;

/**
 * Stock items import (#2530): code, name, optional description, unit (by the unit's code) and optional lead time in days.
 * `create` is the stock module's own `createItem`, so its code-uniqueness and role rules apply unchanged.
 */
export function makeStockItemImportDescriptor(
  units: readonly { id: string; code: string }[], existingCodes: () => Promise<Iterable<string>>, t?: TFunction,
): ImportDescriptor<StockItemInput> {
  const L = labelOf(t);
  const unit = makeRefLookup(units.map((u) => ({ id: u.id, name: u.code })), L('import:stockItem.unit', 'Unit'));
  const F = <K extends string>(key: K, en: string, id: string, required: boolean, validate: (r: string) => string | null, extra = {}) =>
    makeField<StockItemInput>(key, L(`import:stockItem.${key}`, en), required, validate, { aliases: [en, id], ...extra });
  return {
    entity: 'Stock items',
    entityDisplay: L('import:entity.stockItems', 'stock items'),
    entityDisplayOne: L('import:entity.stockItem', 'stock item'),
    rowTitle: (c) => [c.code, c.name].map((v) => (v ?? '').trim()).filter(Boolean).join(' · '),
    template: { version: 1, example: { code: 'CEM-50', name: 'Cement 50 kg bag', description: '', unit: units[0]?.code ?? 'EA', leadTimeDays: '7' }, lists: { unit: units.map((u) => u.code) } },
    fields: [
      F('code', 'Item code', 'Kode item', true, requiredText(L('import:stockItem.error.code', 'Item code is required.'), 40, L('import:stockItem.error.codeLong', 'Item code is too long.')), { inRowTitle: true, hint: L('import:stockItem.codeHint', 'Your own code for the item. Each code is used once.') }),
      F('name', 'Name', 'Nama', true, requiredText(L('import:stockItem.error.name', 'Name is required.'), 200, L('import:stockItem.error.nameLong', 'Name is too long.')), { inRowTitle: true }),
      F('description', 'Description', 'Deskripsi', false, () => null),
      F('unit', 'Unit', 'Satuan', true, refValidate(unit, true), { hint: L('import:stockItem.unitHint', 'The code of an existing unit of measure.') }),
      F('leadTimeDays', 'Lead time (days)', 'Waktu tunggu (hari)', false, (raw) => (raw.trim() === '' || /^\d{1,4}$/.test(raw.trim()) ? null : L('import:stockItem.error.lead', 'Lead time must be a whole number of days.')), { numeric: true }),
    ],
    existingKeys: keyedAlready(existingCodes, 'code', {
      alreadyThere: L('import:stockItem.alreadyThere', 'This item code already exists.'),
      unavailable: L('import:existing.unavailable', 'Could not check which records already exist.'),
      nothingNew: L('import:existing.nothingNew', 'Every row is already there.'),
    }),
    toInput: (c: Cells) => ({
      code: c.code.trim(), name: c.name.trim(), description: c.description?.trim() || null,
      unitId: refId(unit, c.unit ?? '') ?? '', leadTimeDays: c.leadTimeDays?.trim() ? Number(c.leadTimeDays.trim()) : null,
    }),
    create: (input) => repositories.stock.master.createItem(input),
  };
}

const KINDS = ['central', 'site', 'yard', 'staging', 'vendor'] as const;

/** Stock locations (warehouses) import (#2530): code, name, kind and, for site, yard and staging, the project. */
export function makeStockLocationImportDescriptor(
  projects: readonly { id: string; name: string }[], existingCodes: () => Promise<Iterable<string>>, t?: TFunction,
): ImportDescriptor<StockWarehouseInput> {
  const L = labelOf(t);
  const project = makeRefLookup(projects, L('import:stockLocation.project', 'Project'));
  const F = (key: string, en: string, id: string, required: boolean, validate: (r: string) => string | null, extra = {}) =>
    makeField<StockWarehouseInput>(key, L(`import:stockLocation.${key}`, en), required, validate, { aliases: [en, id], ...extra });
  return {
    entity: 'Stock locations',
    entityDisplay: L('import:entity.stockLocations', 'stock locations'),
    entityDisplayOne: L('import:entity.stockLocation', 'stock location'),
    rowTitle: (c) => [c.code, c.name].map((v) => (v ?? '').trim()).filter(Boolean).join(' · '),
    template: { version: 1, example: { code: 'YARD-1', name: 'North yard', kind: 'yard', project: projects[0]?.name ?? '' }, lists: { kind: [...KINDS], ...(projects.length <= 200 ? { project: projects.map((p) => p.name) } : {}) } },
    fields: [
      F('code', 'Location code', 'Kode lokasi', true, requiredText(L('import:stockLocation.error.code', 'Location code is required.'), 40, L('import:stockLocation.error.codeLong', 'Location code is too long.')), { inRowTitle: true }),
      F('name', 'Name', 'Nama', true, requiredText(L('import:stockLocation.error.name', 'Name is required.'), 200, L('import:stockLocation.error.nameLong', 'Name is too long.')), { inRowTitle: true }),
      F('kind', 'Kind', 'Jenis', true, (raw) => ((KINDS as readonly string[]).includes(raw.trim().toLowerCase()) ? null : L('import:stockLocation.error.kind', 'Kind must be central, site, yard, staging or vendor.'))),
      F('project', 'Project', 'Proyek', false, refValidate(project, false), { hint: L('import:stockLocation.projectHint', 'Required for site, yard and staging; leave blank for central.') }),
    ],
    validateRow: (c: Cells) => {
      const kind = (c.kind ?? '').trim().toLowerCase();
      const needs = kind === 'site' || kind === 'yard' || kind === 'staging';
      const has = (c.project ?? '').trim() !== '';
      if (needs && !has) return { project: L('import:stockLocation.error.projectNeeded', 'A project is required for this kind of location.') } as never;
      if (kind === 'vendor' && has) return { project: L('import:stockLocation.error.projectNotAllowedVendor', 'A vendor location has no project.') } as never;
      if (kind === 'central' && has) return { project: L('import:stockLocation.error.projectNotAllowed', 'A central location has no project.') } as never;
      return {};
    },
    existingKeys: keyedAlready(existingCodes, 'code', {
      alreadyThere: L('import:stockLocation.alreadyThere', 'This location code already exists.'),
      unavailable: L('import:existing.unavailable', 'Could not check which records already exist.'),
      nothingNew: L('import:existing.nothingNew', 'Every row is already there.'),
    }),
    toInput: (c: Cells) => ({ code: c.code.trim(), name: c.name.trim(), kind: c.kind.trim().toLowerCase() as StockWarehouseInput['kind'], projectId: refId(project, c.project ?? '') }),
    create: (input) => repositories.stock.master.createWarehouse(input),
  };
}
