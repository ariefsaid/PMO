import { describe, expect, it } from 'vitest';
import {
  workflowVariant,
  severityVariant,
  categoryVariant,
  companyTypeVariant,
  crmActivityVariant,
  ALL_REGISTRY_VARIANTS,
} from './statusVariants';

/**
 * CW-2 — the single status/colour registry. The binding rule (DESIGN.md "Freed-Blue
 * Status Rule"): the action-blue (`open` StatusPill variant) is freed — NO status,
 * severity, or category pill may resolve to it. Colour is for exceptions only;
 * open/active/in-progress is neutral grey (the distinct LABEL carries identity).
 */
describe('statusVariants registry — Freed-Blue Status Rule', () => {
  // (a) The headline guard: no registry mapping may resolve to the action-blue `open` variant.
  it('never resolves any status / severity / category to the primary/action-blue (open) variant', () => {
    expect(ALL_REGISTRY_VARIANTS).not.toContain('open');
    // also `overdue` (amber) is allowed; only `open` (blue tint) is forbidden in status use.
    expect(ALL_REGISTRY_VARIANTS.length).toBeGreaterThan(0);
  });

  describe('workflowVariant — open/active/in-progress → neutral grey, never blue', () => {
    it.each([
      // Procurement PR/PO/GR/VI lifecycle
      ['Draft', 'draft'],
      ['Submitted', 'progress'],
      ['PO Issued', 'progress'],
      ['Goods Received', 'progress'],
      ['Paid', 'won'],
      ['Rejected', 'lost'],
      // Projects status
      ['Ongoing Project', 'progress'],
      ['Won, Pending KoM', 'won'],
      ['Loss Tender', 'lost'],
      ['On Hold', 'warn'],
      // Documents status
      ['Issued', 'progress'],
      ['Approved', 'won'],
      ['Closed', 'neutral'],
      ['Superseded', 'superseded'],
      // Timesheets status
      ['Submitted', 'progress'],
      // Tasks status
      ['To Do', 'neutral'],
      ['In Progress', 'progress'],
      ['Done', 'won'],
      ['Blocked', 'lost'],
      // Incidents workflow status
      ['Open', 'progress'],
      ['Investigating', 'progress'],
      // Budget version status
      ['Active', 'won'],
      ['Archived', 'neutral'],
    ])('maps %s → %s', (status, variant) => {
      expect(workflowVariant(status)).toBe(variant);
      expect(workflowVariant(status)).not.toBe('open');
    });

    it('falls back to neutral for an unknown status (never blue)', () => {
      expect(workflowVariant('Totally Unknown State')).toBe('neutral');
    });
  });

  describe('severityVariant — Low grey, Medium/High amber, Critical red — never blue', () => {
    it.each([
      ['Low', 'neutral'],
      ['Medium', 'warn'],
      ['High', 'warn'],
      ['Critical', 'lost'],
    ] as const)('maps %s → %s', (sev, variant) => {
      expect(severityVariant(sev)).toBe(variant);
    });

    it('does not render Medium severity as action-blue (the DOM-measured collision)', () => {
      expect(severityVariant('Medium')).not.toBe('open');
    });

    it('falls back to neutral for an unknown severity (never blue)', () => {
      expect(severityVariant('Catastrophic')).toBe('neutral');
    });
  });

  describe('categoryVariant — non-status family, violet/neutral, never action-blue', () => {
    it('company "Client" type is violet/neutral, never blue (the DOM-measured collision)', () => {
      expect(companyTypeVariant('Client')).not.toBe('open');
      expect(['violet', 'neutral']).toContain(companyTypeVariant('Client'));
    });

    it.each([
      ['Client', 'violet'],
      ['Vendor', 'neutral'],
      ['Internal', 'neutral'],
    ] as const)('company type %s → %s', (type, variant) => {
      expect(companyTypeVariant(type)).toBe(variant);
    });

    it.each([
      ['Call', 'violet'],
      ['Email', 'neutral'],
      ['Meeting', 'neutral'],
      ['Note', 'neutral'],
    ] as const)('CRM activity kind %s → %s (never blue)', (kind, variant) => {
      expect(crmActivityVariant(kind)).toBe(variant);
      expect(crmActivityVariant(kind)).not.toBe('open');
    });

    it('generic categoryVariant highlights the named kind in violet, rest neutral', () => {
      expect(categoryVariant('A', 'A')).toBe('violet');
      expect(categoryVariant('B', 'A')).toBe('neutral');
    });
  });
});
