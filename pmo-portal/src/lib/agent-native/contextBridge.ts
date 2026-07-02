/**
 * E4 Context Bridge (AC-410) — GREEN phase
 *
 * Feeds PMO's current screen/entity to the agent using `setAgentChatContextItem`
 * (the non-deprecated symbol - per API ref §3).
 *
 * Spec: `docs/plans/2026-07-01-agent-native-adoption-epic.md` E4
 */

import { useEffect, useRef } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { setAgentChatContextItem } from '@agent-native/core/client';
import { isFeatureEnabled } from '@/src/lib/features';

export interface PmoContextBridgeOptions {
  enabled?: boolean;
}

/** Supported PMO entity types for context extraction */
type PmoEntityType = 'project' | 'company' | 'procurement' | 'contact' | 'incident' | 'view';

/** Extracted context from the current route */
interface PmoRouteContext {
  entityType: PmoEntityType | null;
  entityId: string | null;
  entityLabel: string;
  viewName: string;
}

/**
 * Parse the current route to extract entity information for agent context.
 */
export function extractRouteContext(
  pathname: string,
  params: Record<string, string | undefined>
): PmoRouteContext {
  const match = pathname.match(/^\/([^/]+)/);

  if (!match) {
    return {
      entityType: null,
      entityId: null,
      entityLabel: 'Home',
      viewName: 'Home',
    };
  }

  const pathSegment = match[1];
  const viewName = getViewName(pathSegment);

  // Detail routes: /projects/:id, /companies/:id, etc.
  if (params.projectId) {
    return {
      entityType: 'project',
      entityId: params.projectId || null,
      entityLabel: 'Project',
      viewName: 'Project Detail',
    };
  }

  if (params.companyId) {
    return {
      entityType: 'company',
      entityId: params.companyId || null,
      entityLabel: 'Company',
      viewName: 'Company Detail',
    };
  }

  if (params.procurementId) {
    return {
      entityType: 'procurement',
      entityId: params.procurementId || null,
      entityLabel: 'Procurement',
      viewName: 'Procurement Detail',
    };
  }

  if (params.contactId) {
    return {
      entityType: 'contact',
      entityId: params.contactId || null,
      entityLabel: 'Contact',
      viewName: 'Contact Detail',
    };
  }

  if (params.incidentId) {
    return {
      entityType: 'incident',
      entityId: params.incidentId || null,
      entityLabel: 'Incident',
      viewName: 'Incident Detail',
    };
  }

  if (params.viewId) {
    return {
      entityType: 'view',
      entityId: params.viewId || null,
      entityLabel: 'User View',
      viewName: 'Custom View',
    };
  }

  // Index routes: /projects, /companies, etc.
  return {
    entityType: null,
    entityId: null,
    entityLabel: viewName,
    viewName,
  };
}

/** Map URL path segment to human-readable view name */
export function getViewName(pathSegment: string): string {
  const viewNames: Record<string, string> = {
    projects: 'Projects',
    companies: 'Companies',
    procurement: 'Procurement',
    contacts: 'Contacts',
    incidents: 'Incidents',
    'sales-pipeline': 'Sales Pipeline',
    'my-tasks': 'My Tasks',
    timesheets: 'Timesheets',
    approvals: 'Approvals',
    reports: 'Reports',
    administration: 'Administration',
    views: 'Views',
  };

  return viewNames[pathSegment] || pathSegment;
}

/**
 * Hook that feeds PMO's current screen/entity context to the agent.
 *
 * When enabled, it parses the current route and calls `setAgentChatContextItem`
 * with structured context describing the active view and optionally the current
 * record (for detail pages).
 *
 * @param options - Bridge configuration options
 */
export function usePmoContextBridge(options: PmoContextBridgeOptions = {}): void {
  const { enabled: optionsEnabled } = options;
  const location = useLocation();
  const params = useParams();

  // Check both local option and global feature flag
  const enabled = optionsEnabled !== false && isFeatureEnabled('agentNativeEmbed');

  // Track the previous context key to avoid redundant calls
  const prevContextKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const context = extractRouteContext(location.pathname, params);

    // Build a stable key for this context
    const contextKey = context.entityId
      ? `${context.entityType}:${context.entityId}`
      : `view:${context.viewName}`;

    // Skip if the context hasn't changed
    if (contextKey === prevContextKeyRef.current) {
      return;
    }

    prevContextKeyRef.current = contextKey;

    // Build the context string
    let contextText = `User is viewing ${context.viewName}`;

    if (context.entityType && context.entityId) {
      contextText += ` (${context.entityLabel} ID: ${context.entityId})`;
    }

    // Set the context item for the agent
    setAgentChatContextItem({
      key: contextKey,
      title: context.viewName,
      context: contextText,
    });
  }, [enabled, location.pathname, params]);
}