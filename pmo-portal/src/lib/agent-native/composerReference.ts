/**
 * E4 Composer Reference (AC-412) — GREEN phase
 *
 * Wires @-mention references from PMO records to the agent composer.
 * Uses `insertAgentComposerReference` from `@agent-native/core/client`.
 *
 * Spec: `docs/plans/2026-07-01-agent-native-adoption-epic.md` E4
 */

import {
  insertAgentComposerReference,
  type AgentComposerReference,
} from '@agent-native/core/client';
import { isFeatureEnabled } from '@/src/lib/features';

export interface PmoReferenceOptions {
  enabled?: boolean;
}

export interface PmoReference {
  entityType: string;
  entityId: string;
  label: string;
  slotKey?: string;
  slotLabel?: string;
  metadata?: Record<string, unknown>;
  relatedReferences?: PmoReference[];
}

// Supported entity types are validated in convertToAgentReference
const _SUPPORTED_ENTITY_TYPES = new Set([
  'project',
  'company',
  'procurement',
  'contact',
  'incident',
  'view',
] as const);

/**
 * Convert a PMO reference to agent-native format.
 */
function convertToAgentReference(ref: PmoReference): AgentComposerReference | null {
  const { entityType, entityId, label, slotKey, slotLabel, metadata, relatedReferences } = ref;

  // Validate required fields
  if (!entityType || !entityId || !label) {
    return null;
  }

  // Validate entity type
  const _supportedTypes = new Set([
    'project',
    'company',
    'procurement',
    'contact',
    'incident',
    'view',
  ]);

  if (!_supportedTypes.has(entityType)) {
    return null;
  }

  const agentRef: AgentComposerReference = {
    label,
    refType: entityType,
    refId: entityId,
    metadata: metadata || {},
  };

  if (slotKey) {
    agentRef.slotKey = slotKey;
  }

  if (slotLabel) {
    agentRef.slotLabel = slotLabel;
  }

  if (relatedReferences && relatedReferences.length > 0) {
    const convertedRelated = relatedReferences
      .map(convertToAgentReference)
      .filter((r): r is AgentComposerReference => r !== null);

    if (convertedRelated.length > 0) {
      agentRef.relatedReferences = convertedRelated;
    }
  }

  return agentRef;
}

/**
 * Insert a PMO record reference into the agent composer.
 *
 * This function converts PMO entity references to the agent-native format
 * and inserts them into the composer for @-mention style interactions.
 *
 * @param reference - The PMO reference to insert
 * @param options - Bridge configuration options
 */
export function insertPmoReference(
  reference: PmoReference,
  options: PmoReferenceOptions = {}
): void {
  const { enabled: optionsEnabled } = options;

  // Check both local option and global feature flag
  const enabled = optionsEnabled !== false && isFeatureEnabled('agentNativeEmbed');

  if (!enabled) {
    return;
  }

  // Convert to agent-native format
  const agentRef = convertToAgentReference(reference);

  if (!agentRef) {
    return;
  }

  // Insert into the composer
  insertAgentComposerReference(agentRef);
}

/**
 * Validate and normalize a PMO reference.
 *
 * Returns a normalized AgentComposerReference if valid, null otherwise.
 *
 * @param reference - The reference to validate and normalize
 */
export function normalizePmoReference(
  reference: unknown
): AgentComposerReference | null {
  // Try to convert to agent reference
  if (reference && typeof reference === 'object' && !Array.isArray(reference)) {
    const ref = reference as Partial<PmoReference>;

    // Build a PMO reference from the input
    const pmoRef: PmoReference = {
      entityType: ref.entityType || '',
      entityId: ref.entityId || '',
      label: ref.label || '',
      slotKey: ref.slotKey,
      slotLabel: ref.slotLabel,
      metadata: ref.metadata,
      relatedReferences: ref.relatedReferences,
    };

    return convertToAgentReference(pmoRef);
  }

  return null;
}