import type { TFunction } from 'i18next';
import { repositories } from '@/src/lib/repositories';
import { parseNeutralMoneyInputAtScale } from '@/src/lib/format';
import type { ImportDescriptor } from './types';
import { makeRefLookup, refId, refValidate } from './refLookup';
import { keyedAlready, labelOf, makeField, requiredText } from './importShared';

type Cells = Record<string, string>;

export interface EquipmentImportInput {
  code: string; name: string; unit: 'hours' | 'days'; ownership: 'owned' | 'rented';
  vendorId: string | null; rate: string; basis: 'day' | 'month'; currency: string; rentedFrom: string | null; rentedTo: string | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s: string) => ISO.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/**
 * Equipment import (#2530, FR-IMT-011): asset code, name, default unit, ownership and, for a rented asset, the supplier
 * (by name), rate, basis, currency and rental dates. `create` is the equipment module's own path: the asset is created,
 * and a rented asset then gets its ownership and rental term through the availability repository, so every rule there applies.
 */
export function makeEquipmentImportDescriptor(
  vendors: readonly { id: string; name: string }[], existingCodes: () => Promise<Iterable<string>>, currencies: readonly string[] = ['IDR', 'USD'], t?: TFunction,
): ImportDescriptor<EquipmentImportInput> {
  const L = labelOf(t);
  const vendor = makeRefLookup(vendors, L('import:equipment.vendor', 'Supplier'));
  const F = (key: string, en: string, id: string, required: boolean, validate: (r: string) => string | null, extra = {}) =>
    makeField<EquipmentImportInput>(key, L(`import:equipment.${key}`, en), required, validate, { aliases: [en, id], ...extra });
  const rentedOnly = (c: Cells) => (c.ownership ?? '').trim().toLowerCase() === 'rented';
  return {
    entity: 'Equipment',
    entityDisplay: L('import:entity.equipment', 'equipment'),
    entityDisplayOne: L('import:entity.equipmentOne', 'equipment asset'),
    rowTitle: (c) => [c.code, c.name].map((v) => (v ?? '').trim()).filter(Boolean).join(' · '),
    template: {
      version: 1,
      example: { code: 'EXC-01', name: 'Excavator 20t', unit: 'hours', ownership: 'rented', vendor: vendors[0]?.name ?? '', rate: '1500000', basis: 'day', currency: currencies[0] ?? 'IDR', rentedFrom: '2026-01-01', rentedTo: '' },
      lists: { unit: ['hours', 'days'], ownership: ['owned', 'rented'], basis: ['day', 'month'], currency: [...currencies], ...(vendors.length <= 200 ? { vendor: vendors.map((v) => v.name) } : {}) },
    },
    fields: [
      F('code', 'Asset code', 'Kode aset', true, requiredText(L('import:equipment.error.code', 'Asset code is required.'), 40, L('import:equipment.error.codeLong', 'Asset code is too long.')), { inRowTitle: true }),
      F('name', 'Name', 'Nama', true, requiredText(L('import:equipment.error.name', 'Name is required.'), 200, L('import:equipment.error.nameLong', 'Name is too long.')), { inRowTitle: true }),
      F('unit', 'Default unit', 'Satuan bawaan', true, (r) => (['hours', 'days'].includes(r.trim().toLowerCase()) ? null : L('import:equipment.error.unit', 'Default unit must be hours or days.'))),
      F('ownership', 'Ownership', 'Kepemilikan', true, (r) => (['owned', 'rented'].includes(r.trim().toLowerCase()) ? null : L('import:equipment.error.ownership', 'Ownership must be owned or rented.'))),
      F('vendor', 'Supplier', 'Pemasok', false, refValidate(vendor, false), { hint: L('import:equipment.vendorHint', 'Required when rented: the name of an existing supplier.') }),
      F('rate', 'Rental rate', 'Tarif sewa', false, (r) => (r.trim() === '' || (parseNeutralMoneyInputAtScale(r, 2) ?? -1) >= 0 ? null : L('import:equipment.error.rate', 'Rental rate must be a number of 0 or more.')), { numeric: true }),
      F('basis', 'Rate basis', 'Dasar tarif', false, (r) => (r.trim() === '' || ['day', 'month'].includes(r.trim().toLowerCase()) ? null : L('import:equipment.error.basis', 'Rate basis must be day or month.'))),
      F('currency', 'Currency', 'Mata uang', false, (r) => (r.trim() === '' || currencies.includes(r.trim().toUpperCase()) ? null : L('import:equipment.error.currency', 'Currency is not one the organisation uses.'))),
      F('rentedFrom', 'Rental start', 'Mulai sewa', false, (r) => (r.trim() === '' || isDate(r.trim()) ? null : L('import:equipment.error.date', 'Dates are written year-month-day, e.g. 2026-01-31.'))),
      F('rentedTo', 'Rental end', 'Akhir sewa', false, (r) => (r.trim() === '' || isDate(r.trim()) ? null : L('import:equipment.error.date', 'Dates are written year-month-day, e.g. 2026-01-31.'))),
    ],
    validateRow: (c: Cells) => {
      if (!rentedOnly(c)) return {};
      const out: Record<string, string> = {};
      const need = (k: string, msg: string) => { if ((c[k] ?? '').trim() === '') out[k] = msg; };
      need('vendor', L('import:equipment.error.vendorNeeded', 'Supplier is required for a rented asset.'));
      need('rate', L('import:equipment.error.rateNeeded', 'Rental rate is required for a rented asset.'));
      need('basis', L('import:equipment.error.basisNeeded', 'Rate basis is required for a rented asset.'));
      need('currency', L('import:equipment.error.currencyNeeded', 'Currency is required for a rented asset.'));
      need('rentedFrom', L('import:equipment.error.startNeeded', 'Rental start is required for a rented asset.'));
      const from = (c.rentedFrom ?? '').trim(); const to = (c.rentedTo ?? '').trim();
      if (isDate(from) && isDate(to) && to < from) out.rentedTo = L('import:equipment.error.endBefore', 'Rental end is before the rental start.');
      return out as never;
    },
    existingKeys: keyedAlready(existingCodes, 'code', {
      alreadyThere: L('import:equipment.alreadyThere', 'This asset code already exists.'),
      unavailable: L('import:existing.unavailable', 'Could not check which records already exist.'),
      nothingNew: L('import:existing.nothingNew', 'Every row is already there.'),
    }),
    toInput: (c: Cells) => {
      const rented = rentedOnly(c);
      return {
        code: c.code.trim(), name: c.name.trim(), unit: c.unit.trim().toLowerCase() as 'hours' | 'days',
        ownership: rented ? 'rented' : 'owned', vendorId: rented ? refId(vendor, c.vendor ?? '') : null,
        rate: (c.rate ?? '').trim(), basis: (c.basis ?? '').trim().toLowerCase() === 'month' ? 'month' : 'day',
        currency: (c.currency ?? '').trim().toUpperCase(), rentedFrom: (c.rentedFrom ?? '').trim() || null, rentedTo: (c.rentedTo ?? '').trim() || null,
      };
    },
    create: async (i) => {
      const asset = await repositories.equipment.createAsset({ code: i.code, name: i.name, default_unit: i.unit });
      if (i.ownership === 'rented') {
        await repositories.equipmentAvailability.setOwnership(asset.id, 'rented', i.rentedFrom);
        await repositories.equipmentAvailability.saveRentalTerm({
          asset_id: asset.id, vendor_id: i.vendorId ?? '', rate: i.rate, basis: i.basis, currency: i.currency, rented_from: i.rentedFrom ?? '', rented_to: i.rentedTo,
        });
      }
      return asset;
    },
  };
}
