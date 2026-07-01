/**
 * E4 Composer Reference Tests (AC-412) — TDD RED phase
 *
 * Tests that PMO record insertion calls insertAgentComposerReference with structured metadata.
 *
 * Spec: `docs/plans/2026-07-01-agent-native-adoption-epic.md` E4
 * API ref §3: `@agent-native/core/dist/client/agent-chat.d.ts`
 *
 * Owning AC: AC-412
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { insertPmoReference, normalizePmoReference } from './composerReference';

// Mock the agent-native composer reference functions
const mockInsertAgentComposerReference = vi.fn();
const mockNormalizeAgentComposerReference = vi.fn();

vi.mock('@agent-native/core/client', () => ({
  insertAgentComposerReference: (ref: unknown, options?: unknown) =>
    mockInsertAgentComposerReference(ref, options),
  normalizeAgentComposerReference: (value: unknown) =>
    mockNormalizeAgentComposerReference(value),
}));

// Mock the feature flag to return true by default in tests
vi.mock('@/src/lib/features', () => ({
  isFeatureEnabled: () => true,
}));

describe('Composer Reference (AC-412)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('insertPmoReference - insert structured @-mentions', () => {
    it('AC-412.1: Given a project record is selected, When insertPmoReference is called, Then the composer receives a structured @ reference with project metadata', () => {
      mockNormalizeAgentComposerReference.mockReturnValue({
        label: 'Test Project',
        refType: 'project',
        refId: 'proj_123',
        metadata: {},
      });

      insertPmoReference({
        entityType: 'project',
        entityId: 'proj_123',
        label: 'Test Project',
      });

      expect(mockInsertAgentComposerReference).toHaveBeenCalledTimes(1);
      expect(mockInsertAgentComposerReference).toHaveBeenCalledWith(
        {
          label: 'Test Project',
          refType: 'project',
          refId: 'proj_123',
          metadata: {},
        },
        undefined
      );
    });

    it('AC-412.2: Given a company record is selected, When insertPmoReference is called, Then the composer receives a structured @ reference with company metadata', () => {
      mockNormalizeAgentComposerReference.mockReturnValue({
        label: 'Acme Corp',
        refType: 'company',
        refId: 'cmp_456',
        metadata: {},
      });

      insertPmoReference({
        entityType: 'company',
        entityId: 'cmp_456',
        label: 'Acme Corp',
      });

      expect(mockInsertAgentComposerReference).toHaveBeenCalledTimes(1);
      expect(mockInsertAgentComposerReference).toHaveBeenCalledWith(
        {
          label: 'Acme Corp',
          refType: 'company',
          refId: 'cmp_456',
          metadata: {},
        },
        undefined
      );
    });

    it('AC-412.3: Given a procurement record is selected, When insertPmoReference is called, Then the composer receives a structured @ reference with procurement metadata', () => {
      mockNormalizeAgentComposerReference.mockReturnValue({
        label: 'Q4 2026 Procurement',
        refType: 'procurement',
        refId: 'prc_789',
        metadata: {},
      });

      insertPmoReference({
        entityType: 'procurement',
        entityId: 'prc_789',
        label: 'Q4 2026 Procurement',
      });

      expect(mockInsertAgentComposerReference).toHaveBeenCalledTimes(1);
      expect(mockInsertAgentComposerReference).toHaveBeenCalledWith(
        {
          label: 'Q4 2026 Procurement',
          refType: 'procurement',
          refId: 'prc_789',
          metadata: {},
        },
        undefined
      );
    });

    it('AC-412.4: Given a contact record is selected, When insertPmoReference is called, Then the composer receives a structured @ reference with contact metadata', () => {
      mockNormalizeAgentComposerReference.mockReturnValue({
        label: 'John Doe',
        refType: 'contact',
        refId: 'contact_abc',
        metadata: {},
      });

      insertPmoReference({
        entityType: 'contact',
        entityId: 'contact_abc',
        label: 'John Doe',
      });

      expect(mockInsertAgentComposerReference).toHaveBeenCalledTimes(1);
      expect(mockInsertAgentComposerReference).toHaveBeenCalledWith(
        {
          label: 'John Doe',
          refType: 'contact',
          refId: 'contact_abc',
          metadata: {},
        },
        undefined
      );
    });

    it('AC-412.5: Given a reference with a slotKey is inserted, When insertPmoReference is called, Then the reference occupies the specified composer slot', () => {
      mockNormalizeAgentComposerReference.mockReturnValue({
        label: 'Active Project',
        refType: 'project',
        refId: 'proj_xyz',
        slotKey: 'active-project',
        metadata: {},
      });

      insertPmoReference({
        entityType: 'project',
        entityId: 'proj_xyz',
        label: 'Active Project',
        slotKey: 'active-project',
      });

      expect(mockInsertAgentComposerReference).toHaveBeenCalledTimes(1);
      expect(mockInsertAgentComposerReference).toHaveBeenCalledWith(
        {
          label: 'Active Project',
          refType: 'project',
          refId: 'proj_xyz',
          slotKey: 'active-project',
          metadata: {},
        },
        undefined
      );
    });

    it('AC-412.6: Given a reference with related references is inserted, When insertPmoReference is called, Then the composer receives both the primary and related references', () => {
      mockNormalizeAgentComposerReference.mockReturnValue({
        label: 'Acme Corp',
        refType: 'company',
        refId: 'cmp_acme',
        metadata: {},
        relatedReferences: [
          {
            label: 'Project Alpha',
            refType: 'project',
            refId: 'proj_alpha',
          },
        ],
      });

      insertPmoReference({
        entityType: 'company',
        entityId: 'cmp_acme',
        label: 'Acme Corp',
        relatedReferences: [
          {
            entityType: 'project',
            entityId: 'proj_alpha',
            label: 'Project Alpha',
          },
        ],
      });

      expect(mockInsertAgentComposerReference).toHaveBeenCalledTimes(1);
      expect(mockInsertAgentComposerReference).toHaveBeenCalledWith(
        {
          label: 'Acme Corp',
          refType: 'company',
          refId: 'cmp_acme',
          metadata: {},
          relatedReferences: [
            {
              label: 'Project Alpha',
              refType: 'project',
              refId: 'proj_alpha',
              metadata: {},
            },
          ],
        },
        undefined
      );
    });

    it('AC-412.7: Given the feature flag is off, When insertPmoReference is called, Then no reference is inserted (bridge is no-op)', () => {
      mockNormalizeAgentComposerReference.mockReturnValue({
        label: 'Test Project',
        refType: 'project',
        refId: 'proj_123',
        metadata: {},
      });

      insertPmoReference(
        {
          entityType: 'project',
          entityId: 'proj_123',
          label: 'Test Project',
        },
        { enabled: false }
      );

      expect(mockInsertAgentComposerReference).not.toHaveBeenCalled();
    });
  });

  describe('normalizePmoReference - validate and normalize references', () => {
    it('AC-412.8: Given a valid PMO reference object, When normalizePmoReference is called, Then it returns a normalized AgentComposerReference', () => {
      const result = normalizePmoReference({
        entityType: 'project',
        entityId: 'proj_123',
        label: 'Test Project',
      });

      expect(result).toEqual({
        label: 'Test Project',
        refType: 'project',
        refId: 'proj_123',
        metadata: {},
      });
    });

    it('AC-412.9: Given a reference with additional metadata, When normalizePmoReference is called, Then the metadata is preserved', () => {
      const result = normalizePmoReference({
        entityType: 'company',
        entityId: 'cmp_456',
        label: 'Acme Corp',
        metadata: {
          industry: 'Technology',
          location: 'San Francisco',
        },
      });

      expect(result).toEqual({
        label: 'Acme Corp',
        refType: 'company',
        refId: 'cmp_456',
        metadata: {
          industry: 'Technology',
          location: 'San Francisco',
        },
      });
    });

    it('AC-412.10: Given an invalid reference (missing required fields), When normalizePmoReference is called, Then it returns null', () => {
      const result = normalizePmoReference({
        entityType: 'project',
        // Missing entityId and label
      } as Record<string, string>);

      expect(result).toBeNull();
    });

    it('AC-412.11: Given an unsupported entity type, When normalizePmoReference is called, Then it returns null', () => {
      const result = normalizePmoReference({
        entityType: 'unsupported-type' as unknown as string,
        entityId: 'xyz_123',
        label: 'Unsupported Entity',
      });

      expect(result).toBeNull();
    });
  });
});