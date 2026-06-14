/**
 * AC-JR-W4-04 — Single status→variant authority guard (ADR-0029).
 *
 * Asserts that `pillVariantForProjectStatus` (components/projects.ts) and
 * `pillVariantForStatus` (components/salesPipeline.ts) agree with the CW-2
 * registry `workflowVariant` on EVERY project.status enum value.
 *
 * This is the regression net: if either helper diverges from the registry the
 * test fails at import-graph-wide build time (never silently).
 */
import { describe, it, expect } from 'vitest';
import { pillVariantForProjectStatus } from '../projects';
import { pillVariantForStatus } from '../salesPipeline';
import { workflowVariant } from '@/src/lib/status/statusVariants';

/** Every projects.status enum value (from DB schema + projectTransitions). */
const ALL_PROJECT_STATUSES = [
  'Leads',
  'PQ Submitted',
  'Quotation Submitted',
  'Tender Submitted',
  'Negotiation',
  'Ongoing Project',
  'Won, Pending KoM',
  'Close Out',
  'On Hold',
  'Loss Tender',
  'Internal Project',
] as const;

describe('AC-JR-W4-04: status→variant single authority (ADR-0029)', () => {
  it('pillVariantForProjectStatus agrees with workflowVariant on every project status', () => {
    for (const status of ALL_PROJECT_STATUSES) {
      expect(pillVariantForProjectStatus(status)).toBe(workflowVariant(status));
    }
  });

  it('pillVariantForStatus (salesPipeline) agrees with workflowVariant on every project status', () => {
    for (const status of ALL_PROJECT_STATUSES) {
      expect(pillVariantForStatus(status)).toBe(workflowVariant(status));
    }
  });

  it('both helpers agree with each other on every project status', () => {
    for (const status of ALL_PROJECT_STATUSES) {
      expect(pillVariantForProjectStatus(status)).toBe(pillVariantForStatus(status));
    }
  });
});
