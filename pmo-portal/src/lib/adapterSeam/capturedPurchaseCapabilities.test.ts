import { describe, expect, it } from 'vitest';
import { capturedPurchaseCapabilities } from './capabilityMap.ts';

describe('captured purchase tier declarations', () => {
  it('declares reference payment and step policy for the supported tier', () => {
    expect(capturedPurchaseCapabilities('erpnext')).toEqual({ payCapturedInvoice: true, applyStepPolicy: true });
  });
  it('declares captured continuation unavailable for the other tier', () => {
    expect(capturedPurchaseCapabilities('odoo')).toEqual({ payCapturedInvoice: false, applyStepPolicy: false });
  });
  it('treats an undeclared tier as unable to continue a capture', () => {
    expect(capturedPurchaseCapabilities('unregistered').payCapturedInvoice).toBe(false);
  });
});
