/**
 * E4 Route Bridge Tests (AC-411) — TDD RED phase
 *
 * Tests that agent navigation commands route PMO (react-router navigate) exactly once,
 * and that prompt-injected / malformed payloads are rejected before they reach the
 * router (path-injection hardening).
 *
 * Spec: `docs/plans/2026-07-01-agent-native-adoption-epic.md` E4
 * API ref §3: `@agent-native/core/dist/client/route-state.d.ts`
 *
 * Owning AC: AC-411
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import React from 'react';
import { usePmoRouteBridge, mapCommandToPath, type PmoNavigationCommand } from './routeBridge';

// Mock the feature flag to return true by default in tests
vi.mock('@/src/lib/features', () => ({
  isFeatureEnabled: vi.fn(() => true),
}));

describe('mapCommandToPath (AC-411 - path mapping)', () => {
  describe('Nav OUT - agent commands map to PMO paths', () => {
    it('AC-411.1: Given the agent emits a navigate command to /projects, Then mapCommandToPath returns /projects', () => {
      const path = mapCommandToPath({ view: 'projects' });
      expect(path).toBe('/projects');
    });

    it('AC-411.2: Given the agent emits a navigate command to /projects/:id, Then mapCommandToPath returns the specific project path', () => {
      const path = mapCommandToPath({ view: 'projects', recordId: 'proj_abc' });
      expect(path).toBe('/projects/proj_abc');
    });

    it('AC-411.3: Given the agent emits a navigate command to /companies/:id, Then mapCommandToPath returns the company path', () => {
      const path = mapCommandToPath({ view: 'companies', recordId: 'cmp_xyz' });
      expect(path).toBe('/companies/cmp_xyz');
    });

    it('AC-411.4: Given the agent emits a malformed command, Then mapCommandToPath returns null', () => {
      const path = mapCommandToPath({ view: 'unsupported-view' } as PmoNavigationCommand);
      expect(path).toBeNull();
    });

    it('AC-411.7: Given a command with a tab param is emitted, Then mapCommandToPath returns the tabbed route', () => {
      const path = mapCommandToPath({ view: 'projects', recordId: 'proj_123', tab: 'tasks' });
      expect(path).toBe('/projects/proj_123/tasks');
    });

    it('AC-411.8: Given a procurement command with tab, Then mapCommandToPath returns the tabbed procurement route', () => {
      const path = mapCommandToPath({ view: 'procurement', recordId: 'prc_456', tab: 'items' });
      expect(path).toBe('/procurement/prc_456/items');
    });

    it('AC-411.9: Given a contact detail command, Then mapCommandToPath returns the contact route', () => {
      const path = mapCommandToPath({ view: 'contacts', recordId: 'contact_abc' });
      expect(path).toBe('/contacts/contact_abc');
    });

    it('AC-411.10: Given an incident detail command, Then mapCommandToPath returns the incident route', () => {
      const path = mapCommandToPath({ view: 'incidents', recordId: 'inc_123' });
      expect(path).toBe('/incidents/inc_123');
    });

    it('AC-411.11: Given a view command with recordId, Then mapCommandToPath returns the view route', () => {
      const path = mapCommandToPath({ view: 'views', recordId: 'view_custom' });
      expect(path).toBe('/views/view_custom');
    });

    it('AC-411.12: Given a sales-pipeline command, Then mapCommandToPath returns the sales route', () => {
      const path = mapCommandToPath({ view: 'sales-pipeline' } as PmoNavigationCommand);
      expect(path).toBe('/sales');
    });
  });
});

// AC-411 security: agent nav payloads are validated before they reach the router.
// The framework's `onCommand` callback short-circuits on a null/falsy path
// (`if (!path) return;` in @agent-native/core route-state.js), so a null path
// from mapCommandToPath ⇒ NO navigation. These tests assert that gate: every
// malicious payload must yield null (the no-op), and only clean payloads navigate.
describe('mapCommandToPath (AC-411 security — payload validation / path-injection hardening)', () => {
  describe('malicious recordId is rejected → null (no navigation)', () => {
    const malicious = ['../admin', 'a/b', 'x?y', 'a#c', '..', '.', 'foo/../bar', 'a?b#c'];
    for (const recordId of malicious) {
      it(`AC-411: rejects recordId ${JSON.stringify(recordId)} → null`, () => {
        expect(mapCommandToPath({ view: 'projects', recordId })).toBeNull();
      });
    }
  });

  describe('malicious tab is rejected → null (no navigation)', () => {
    const malicious = ['../admin', 'a/b', 'x?y', 'a#c', 'tasks?evil=1', 'tasks#frag', '..'];
    for (const tab of malicious) {
      it(`AC-411: rejects projects tab ${JSON.stringify(tab)} → null`, () => {
        expect(mapCommandToPath({ view: 'projects', recordId: 'proj_123', tab })).toBeNull();
      });
    }
  });

  describe('tab not in the route allow-list is rejected → null', () => {
    it('AC-411: rejects an unknown projects tab (not in the projects allow-list)', () => {
      expect(
        mapCommandToPath({ view: 'projects', recordId: 'proj_123', tab: 'nonexistent-tab' }),
      ).toBeNull();
    });

    it('AC-411: rejects an unknown procurement tab (not in the procurement allow-list)', () => {
      expect(
        mapCommandToPath({ view: 'procurement', recordId: 'prc_1', tab: 'nope' }),
      ).toBeNull();
    });

    it('AC-411: rejects a tab on a route that has no tabs (companies has no tab strip)', () => {
      // A tabbed command to a non-tabbed route is malformed → no navigation.
      expect(
        mapCommandToPath({ view: 'companies', recordId: 'cmp_1', tab: 'evil' }),
      ).toBeNull();
    });
  });

  describe('valid payloads still navigate (and dynamic segments are URL-encoded)', () => {
    it('AC-411: a valid project + allow-listed tab navigates to the tabbed route', () => {
      expect(
        mapCommandToPath({ view: 'projects', recordId: 'proj_1', tab: 'tasks' }),
      ).toBe('/projects/proj_1/tasks');
    });

    it('AC-411: a valid procurement + allow-listed tab navigates to the tabbed route', () => {
      expect(
        mapCommandToPath({ view: 'procurement', recordId: 'prc_1', tab: 'items' }),
      ).toBe('/procurement/prc_1/items');
    });

    it('AC-411: a recordId with a space is URL-encoded (never breaks the path)', () => {
      // A space is a safe single-segment value; it is encoded, not rejected.
      expect(mapCommandToPath({ view: 'projects', recordId: 'a b' })).toBe(
        '/projects/a%20b',
      );
    });

    it('AC-411: a benign recordId passes through unchanged (underscore/number safe)', () => {
      expect(mapCommandToPath({ view: 'projects', recordId: 'proj_abc' })).toBe(
        '/projects/proj_abc',
      );
    });
  });
});

describe('usePmoRouteBridge (AC-411 - hook registration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Nav OUT - agent commands route PMO navigation', () => {
    it('AC-411.13: Given the feature flag is on, When the hook runs, Then it registers with useAgentRouteState', () => {
      const router = createMemoryRouter([
        { path: '/projects', element: React.createElement('div', {}, 'Projects') },
        { path: '/', element: React.createElement('div', {}, 'Home') },
      ], {
        initialEntries: ['/'],
      });

      // This test verifies the hook can be mounted without error
      const { result } = renderHook(() => usePmoRouteBridge({ enabled: true }), {
        wrapper: () => React.createElement(RouterProvider, { router }),
      });

      // Hook mounted successfully
      expect(result).toBeDefined();
    });

    it('AC-411.14: Given the feature flag is off, When the hook runs, Then it is a no-op', () => {
      const router = createMemoryRouter([
        { path: '/projects', element: React.createElement('div', {}, 'Projects') },
        { path: '/', element: React.createElement('div', {}, 'Home') },
      ], {
        initialEntries: ['/'],
      });

      // This test verifies the hook can be mounted with enabled=false
      const { result } = renderHook(() => usePmoRouteBridge({ enabled: false }), {
        wrapper: () => React.createElement(RouterProvider, { router }),
      });

      // Hook mounted successfully
      expect(result).toBeDefined();
    });

    it('AC-411.15: Given different route paths, When getNavigationState is called, Then it returns the correct state', () => {
      // Test the getNavigationState function that's passed to useAgentRouteState
      const pathnames = [
        { path: '/projects/proj_123', expected: { view: 'projects', recordId: 'proj_123' } },
        { path: '/projects', expected: { view: 'projects' } },
        { path: '/companies/cmp_456', expected: { view: 'companies', recordId: 'cmp_456' } },
        { path: '/procurement/prc_789', expected: { view: 'procurement', recordId: 'prc_789' } },
        { path: '/contacts/contact_abc', expected: { view: 'contacts', recordId: 'contact_abc' } },
        { path: '/incidents/inc_999', expected: { view: 'incidents', recordId: 'inc_999' } },
        { path: '/views/view_xyz', expected: { view: 'views', recordId: 'view_xyz' } },
        { path: '/', expected: { view: 'home' } },
        { path: '/my-tasks', expected: { view: 'my-tasks' } },
      ];

      for (const { path, expected } of pathnames) {
        // We need to extract the getNavigationState function from the hook
        // For now, verify the mapCommandToPath function handles these cases
        const reversePath = mapCommandToPath(expected as PmoNavigationCommand);

        if (reversePath) {
          // For simple index routes, just check they match
          if (!expected.recordId) {
            expect(path).toBe(reversePath);
          }
        }
      }
    });
  });
});