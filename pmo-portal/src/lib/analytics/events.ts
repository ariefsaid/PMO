/**
 * Analytics event contract and sanitizer.
 *
 * Only `src/lib/analytics/client.ts` should call these; components use the
 * client facade or the helper builders exported here.
 */

// ---------------------------------------------------------------------------
// Event name union — extend this when adding new events (AC-PH-015)
// ---------------------------------------------------------------------------
export type AnalyticsEventName =
  | 'demo_persona_selected'
  | 'app_route_viewed'
  | 'auth_login_succeeded'
  | 'auth_login_failed'
  | 'auth_logout_succeeded'
  | 'project_detail_opened'
  | 'project_tab_viewed'
  | 'procurement_detail_opened'
  | 'filter_applied'
  | 'search_used'
  | 'coming_soon_clicked'
  | 'form_validation_failed'
  | 'save_failed'
  | 'permission_denied_seen'
  | 'empty_state_seen';

// ---------------------------------------------------------------------------
// Safe property types
// ---------------------------------------------------------------------------
export type SafeValue = string | number | boolean | null | undefined;
export type SafeProperties = Record<string, SafeValue>;

// ---------------------------------------------------------------------------
// Forbidden property keys — never send as analytics properties
// ---------------------------------------------------------------------------
export const FORBIDDEN_PROPERTY_KEYS = new Set([
  'email', 'name', 'full_name', 'person_name', 'company_name', 'project_name',
  'procurement_title', 'contract_value', 'budget', 'budget_amount', 'token',
  'access_token', 'refresh_token', 'notes', 'note', 'comment', 'comments',
  'file_name', 'file', 'password', 'query', 'search_params',
]);

// ---------------------------------------------------------------------------
// Sanitizer — rejects forbidden keys / unsafe shapes
// ---------------------------------------------------------------------------
export function buildEventProperties(
  event: AnalyticsEventName,
  properties: SafeProperties,
  production = import.meta.env.PROD,
): SafeProperties {
  const safe: SafeProperties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (FORBIDDEN_PROPERTY_KEYS.has(key)) {
      if (!production) throw new Error(`Forbidden analytics property for ${event}: ${key}`);
      continue;
    }
    if (typeof value === 'object' && value !== null) {
      if (!production) throw new Error(`Unsafe analytics value for ${event}: ${key}`);
      continue;
    }
    safe[key] = value;
  }
  return safe;
}

// ---------------------------------------------------------------------------
// Helper builders — return { event, properties } for explicit event types
// ---------------------------------------------------------------------------

export interface TrackedEvent {
  event: AnalyticsEventName;
  properties: SafeProperties;
}

export function trackFormValidationFailed(
  formId: string,
  fieldCount: number,
  reasonCode: string,
  module: string,
): TrackedEvent {
  return {
    event: 'form_validation_failed',
    properties: { form_id: formId, field_count: fieldCount, reason_code: reasonCode, module },
  };
}

export function trackSaveFailed(
  entityType: string,
  operation: string,
  reasonCode: string,
  module: string,
): TrackedEvent {
  return {
    event: 'save_failed',
    properties: { entity_type: entityType, operation, reason_code: reasonCode, module },
  };
}

export function trackPermissionDeniedSeen(
  surface: string,
  role: string,
  module: string,
): TrackedEvent {
  return {
    event: 'permission_denied_seen',
    properties: { surface, role, module },
  };
}

export function trackEmptyStateSeen(
  stateId: string,
  role: string,
  module: string,
): TrackedEvent {
  return {
    event: 'empty_state_seen',
    properties: { state_id: stateId, role, module },
  };
}
