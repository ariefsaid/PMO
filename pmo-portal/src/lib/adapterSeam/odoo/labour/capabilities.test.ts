import { describe, expect, it } from 'vitest';
import { LABOUR_MODELS, type ModelProbe } from '../discovery.ts';
import { labourCapabilityGap } from './capabilities.ts';

const OK: ModelProbe = { exists: true, read: true, create: true, write: true, unlink: false, fields_missing: [] };
const full = () => Object.fromEntries(Object.keys(LABOUR_MODELS).map((m) => [m, { ...OK }])) as Record<string, ModelProbe>;
const snap = (patch: Record<string, Partial<ModelProbe>>) => {
  const labour = full();
  for (const [m, p] of Object.entries(patch)) labour[m] = { ...labour[m], ...p };
  return { labour };
};

describe('odoo/labour/capabilities — AC-OLH-001 labourCapabilityGap', () => {
  it('AC-OLH-001 no snapshot, or one from before the labour probe, fails closed naming the first model', () => {
    expect(labourCapabilityGap(null)).toBe('hr.employee');
    expect(labourCapabilityGap({})).toBe('hr.employee');
  });
  it('AC-OLH-001 a full snapshot has no gap', () => {
    expect(labourCapabilityGap(snap({}))).toBeNull();
  });
  it('AC-OLH-001 the write models need create and write, named model:operation', () => {
    expect(labourCapabilityGap(snap({ 'account.analytic.line': { create: false } }))).toBe('account.analytic.line:create');
    expect(labourCapabilityGap(snap({ 'account.move': { write: false } }))).toBe('account.move:write');
    expect(labourCapabilityGap(snap({ 'account.move.line': { create: false } }))).toBe('account.move.line:create');
  });
  it('AC-OLH-001 the employee model is read-only: PMO never creates an Odoo employee (D6)', () => {
    expect(labourCapabilityGap(snap({ 'hr.employee': { create: false, write: false } }))).toBeNull();
  });
  it('AC-OLH-001 a missing field is named model:field', () => {
    expect(labourCapabilityGap(snap({ 'account.analytic.line': { fields_missing: ['unit_amount'] } }))).toBe('account.analytic.line:unit_amount');
  });
  it('AC-OLH-001 the anchor model needs create only', () => {
    expect(labourCapabilityGap(snap({ 'ir.model.data': { write: false } }))).toBeNull();
    expect(labourCapabilityGap(snap({ 'ir.model.data': { create: false } }))).toBe('ir.model.data:create');
  });
  it('AC-OLH-001 an absent or unreadable model is named by itself', () => {
    expect(labourCapabilityGap(snap({ 'account.analytic.line': { exists: false, read: false } }))).toBe('account.analytic.line');
    expect(labourCapabilityGap(snap({ 'hr.employee': { read: false } }))).toBe('hr.employee');
  });
  it('AC-OLH-001 the walk order is LABOUR_MODELS order, and it names the first gap it finds', () => {
    expect(labourCapabilityGap(snap({ 'hr.employee': { read: false }, 'account.move': { write: false } }))).toBe('hr.employee');
    expect(labourCapabilityGap(snap({ 'account.move': { write: false }, 'hr.employee': { create: false, write: false } }))).toBe('account.move:write');
  });
});
