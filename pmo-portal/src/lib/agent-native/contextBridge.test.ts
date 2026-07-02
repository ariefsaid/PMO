/**
 * E4 Context Bridge Tests (AC-410) — TDD GREEN phase
 *
 * Tests that PMO's current screen/entity is converted into structured context objects
 * and staged with setAgentChatContextItem (the non-deprecated symbol).
 *
 * Spec: `docs/plans/2026-07-01-agent-native-adoption-epic.md` E4
 * API ref §3: `@agent-native/core/dist/client/agent-chat.d.ts`
 *
 * Owning AC: AC-410
 */

import { describe, it, expect, vi } from 'vitest';

// Mock the feature flag to return true by default in tests
vi.mock('@/src/lib/features', () => ({
  isFeatureEnabled: vi.fn(() => true),
}));

// Mock the agent-native context functions
const mockSetAgentChatContextItem = vi.fn();
vi.mock('@agent-native/core/client', () => ({
  setAgentChatContextItem: (opts: unknown) => mockSetAgentChatContextItem(opts),
}));

import { extractRouteContext, getViewName } from './contextBridge';

describe('extractRouteContext (AC-410)', () => {
  describe('Context IN - extract PMO route context', () => {
    it('AC-410.1: Given a project detail pathname, When extractRouteContext is called, Then it returns project context with entity ID', () => {
      const context = extractRouteContext('/projects/proj_123', { projectId: 'proj_123' });

      expect(context).toEqual({
        entityType: 'project',
        entityId: 'proj_123',
        entityLabel: 'Project',
        viewName: 'Project Detail',
      });
    });

    it('AC-410.2: Given a company detail pathname, When extractRouteContext is called, Then it returns company context with entity ID', () => {
      const context = extractRouteContext('/companies/cmp_456', { companyId: 'cmp_456' });

      expect(context).toEqual({
        entityType: 'company',
        entityId: 'cmp_456',
        entityLabel: 'Company',
        viewName: 'Company Detail',
      });
    });

    it('AC-410.3: Given a procurement detail pathname, When extractRouteContext is called, Then it returns procurement context with entity ID', () => {
      const context = extractRouteContext('/procurement/prc_789', { procurementId: 'prc_789' });

      expect(context).toEqual({
        entityType: 'procurement',
        entityId: 'prc_789',
        entityLabel: 'Procurement',
        viewName: 'Procurement Detail',
      });
    });

    it('AC-410.4: Given an index page pathname, When extractRouteContext is called, Then it returns view context without entity ID', () => {
      const context = extractRouteContext('/projects', {});

      expect(context).toEqual({
        entityType: null,
        entityId: null,
        entityLabel: 'Projects',
        viewName: 'Projects',
      });
    });

    it('AC-410.5: Given a home pathname, When extractRouteContext is called, Then it returns home context', () => {
      const context = extractRouteContext('/', {});

      expect(context).toEqual({
        entityType: null,
        entityId: null,
        entityLabel: 'Home',
        viewName: 'Home',
      });
    });

    it('AC-410.6: Given a contact detail pathname, When extractRouteContext is called, Then it returns contact context with entity ID', () => {
      const context = extractRouteContext('/contacts/contact_abc', { contactId: 'contact_abc' });

      expect(context).toEqual({
        entityType: 'contact',
        entityId: 'contact_abc',
        entityLabel: 'Contact',
        viewName: 'Contact Detail',
      });
    });

    it('AC-410.7: Given an incident detail pathname, When extractRouteContext is called, Then it returns incident context with entity ID', () => {
      const context = extractRouteContext('/incidents/inc_999', { incidentId: 'inc_999' });

      expect(context).toEqual({
        entityType: 'incident',
        entityId: 'inc_999',
        entityLabel: 'Incident',
        viewName: 'Incident Detail',
      });
    });

    it('AC-410.8: Given a view pathname, When extractRouteContext is called, Then it returns view context with entity ID', () => {
      const context = extractRouteContext('/views/view_xyz', { viewId: 'view_xyz' });

      expect(context).toEqual({
        entityType: 'view',
        entityId: 'view_xyz',
        entityLabel: 'User View',
        viewName: 'Custom View',
      });
    });
  });
});

describe('getViewName (AC-410)', () => {
  describe('Context IN - map path segments to view names', () => {
    it('AC-410.9: Given projects path segment, When getViewName is called, Then it returns "Projects"', () => {
      const viewName = getViewName('projects');
      expect(viewName).toBe('Projects');
    });

    it('AC-410.10: Given companies path segment, When getViewName is called, Then it returns "Companies"', () => {
      const viewName = getViewName('companies');
      expect(viewName).toBe('Companies');
    });

    it('AC-410.11: Given procurement path segment, When getViewName is called, Then it returns "Procurement"', () => {
      const viewName = getViewName('procurement');
      expect(viewName).toBe('Procurement');
    });

    it('AC-410.12: Given sales-pipeline path segment, When getViewName is called, Then it returns "Sales Pipeline"', () => {
      const viewName = getViewName('sales-pipeline');
      expect(viewName).toBe('Sales Pipeline');
    });

    it('AC-410.13: Given an unknown path segment, When getViewName is called, Then it returns the segment as-is', () => {
      const viewName = getViewName('unknown-path');
      expect(viewName).toBe('unknown-path');
    });
  });
});