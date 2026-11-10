import { describe, expect, it } from 'vitest';
import { ASSET_MODELS, type ModelProbe } from '../discovery.ts';
import { equipmentCapabilityGap } from './capabilities.ts';

const OK: ModelProbe = { exists: true, read: true, create: true, write: true, unlink: false, fields_missing: [] };
const full = () => Object.fromEntries(Object.keys(ASSET_MODELS).map((m) => [m, { ...OK }])) as Record<string, ModelProbe>;
const snap = (patch: Record<string, Partial<ModelProbe>>) => {
  const assets = full();
  for (const [m, p] of Object.entries(patch)) assets[m] = { ...assets[m], ...p };
  return { assets };
};

describe('odoo/assets/capabilities — AC-OFM-001 equipmentCapabilityGap', () => {
  it('AC-OFM-001 no snapshot, or one from before the asset probe, fails closed naming the first model', () => {
    expect(equipmentCapabilityGap(null)).toBe('fleet.vehicle');
    expect(equipmentCapabilityGap({})).toBe('fleet.vehicle');
  });
  it('AC-OFM-001 a full snapshot has no gap', () => {
    expect(equipmentCapabilityGap(snap({}))).toBeNull();
  });
  it('AC-OFM-001 a request model without create is named model:create', () => {
    expect(equipmentCapabilityGap(snap({ 'maintenance.request': { create: false } }))).toBe('maintenance.request:create');
  });
  it('AC-OFM-001 a writable model without write is named model:write', () => {
    expect(equipmentCapabilityGap(snap({ 'fleet.vehicle.log.services': { write: false } }))).toBe('fleet.vehicle.log.services:write');
  });
  it('AC-OFM-001 a read-only model does not need create', () => {
    expect(equipmentCapabilityGap(snap({ 'fleet.vehicle.model': { create: false, write: false } }))).toBeNull();
  });
  it('AC-OFM-001 a missing field is named model:field', () => {
    expect(equipmentCapabilityGap(snap({ 'maintenance.equipment': { fields_missing: ['serial_no'] } }))).toBe('maintenance.equipment:serial_no');
  });
  it('AC-OFM-001 the anchor model needs create only', () => {
    expect(equipmentCapabilityGap(snap({ 'ir.model.data': { write: false } }))).toBeNull();
    expect(equipmentCapabilityGap(snap({ 'ir.model.data': { create: false } }))).toBe('ir.model.data:create');
  });
  it('AC-OFM-001 an absent or unreadable model is named by itself', () => {
    expect(equipmentCapabilityGap(snap({ 'maintenance.stage': { exists: false, read: false } }))).toBe('maintenance.stage');
    expect(equipmentCapabilityGap(snap({ 'fleet.service.type': { read: false } }))).toBe('fleet.service.type');
  });
});
