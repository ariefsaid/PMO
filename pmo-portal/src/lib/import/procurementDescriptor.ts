import { repositories } from '@/src/lib/repositories';
import type { NewProcurementInput } from '@/src/lib/db/procurementCrud';
import type { ImportDescriptor } from './types';
import { makeRefLookup, refValidate, refId } from './refLookup';

/**
 * Procurement import descriptor (ADR-0027 fast-follow). Factory: closes over the org's projects
 * (→ `projectId`), vendor companies (→ `vendorId`), and the CURRENT USER — `createProcurement`
 * takes `requestedById` as a second arg the spreadsheet cannot supply, so the factory injects it
 * (a crafted xlsx can carry neither org_id nor a foreign requester). Status is forced to `Draft`
 * by `createProcurement`, never imported. `create` delegates to `repositories.procurement.create`
 * (RLS `procurements_write` is the sole write authority).
 */
export function makeProcurementImportDescriptor(
  projects: readonly { id: string; name: string }[],
  vendors: readonly { id: string; name: string }[],
  requestedById: string,
): ImportDescriptor<NewProcurementInput> {
  const project = makeRefLookup(projects, 'Project');
  const vendor = makeRefLookup(vendors, 'Vendor');
  return {
    entity: 'Procurement',
    fields: [
      {
        key: 'title',
        label: 'Title',
        required: true,
        validate: (raw) => (raw.trim() ? null : 'Title is required.'),
      },
      { key: 'projectId', label: 'Project', required: false, validate: refValidate(project, false) },
      { key: 'vendorId', label: 'Vendor', required: false, validate: refValidate(vendor, false) },
    ],
    toInput: (cells) => ({
      title: cells.title.trim(),
      projectId: refId(project, cells.projectId ?? ''),
      vendorId: refId(vendor, cells.vendorId ?? ''),
    }),
    create: (input) => repositories.procurement.create(input, requestedById),
  };
}
