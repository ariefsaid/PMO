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

/**
 * Supported entity types (validated in convertToAgentReference).
 */
const SUPPORTED_ENTITY_TYPES = new Set([
  'project',
  'company',
  'procurement',
  'contact',
  'incident',
  'view',
]);

/**
 * Per-entity minimal metadata allow-list (PII minimization, AC-412).
 *
 * The composer only needs a small set of NON-PII business-classification /
 * lifecycle keys to render + group a reference. Everything else — email, phone,
 * address, registration numbers, personal names, notes, free-form fields — is
 * DROPPED before it crosses into the agent composer. `id` / `name` / `type`
 * already ride on the reference top-level (refId / label / refType), so they
 * are NOT re-admitted via metadata. Contacts carry the most personal PII, so
 * their allow-list is empty.
 */
const METADATA_ALLOWLIST: Readonly<Record<string, ReadonlySet<string>>> = {
  project: new Set(['status', 'code']),
  company: new Set(['industry', 'status']),
  procurement: new Set(['status', 'code']),
  contact: new Set(),
  incident: new Set(['status', 'severity']),
  view: new Set(),
};

/**
 * Maximum number of nested related references kept per level (AC-412).
 *
 * Caps unbounded fan-out / a pathological or cyclic input from flooding the
 * composer with references (and bounds the recursive conversion).
 */
export const MAX_RELATED_REFERENCES = 5;

/**
 * Maximum nesting depth for related references (AC-412). Guards against deep /
 * cyclic graphs hanging the recursive conversion.
 */
const MAX_RELATED_DEPTH = 3;

/**
 * Strip metadata down to the per-entity allow-list of non-PII keys (AC-412).
 */
function sanitizeMetadata(
  entityType: string,
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const allow = METADATA_ALLOWLIST[entityType];
  if (!allow || allow.size === 0 || !metadata) {
    // Fresh object per call — never share a mutable instance across references.
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(metadata)) {
    if (allow.has(key) && metadata[key] !== undefined) {
      out[key] = metadata[key];
    }
  }
  return out;
}

/**
 * Convert a PMO reference to agent-native format (depth-bounded recursion).
 *
 * Returns null for invalid references. Metadata is reduced to the per-entity
 * allow-list and related references are capped (≤ MAX_RELATED_REFERENCES) and
 * depth-limited (≤ MAX_RELATED_DEPTH).
 */
function convertToAgentReference(
  ref: PmoReference,
  depth = 0,
): AgentComposerReference | null {
  const { entityType, entityId, label, slotKey, slotLabel, metadata, relatedReferences } = ref;

  // Validate required fields
  if (!entityType || !entityId || !label) {
    return null;
  }

  // Validate entity type
  if (!SUPPORTED_ENTITY_TYPES.has(entityType)) {
    return null;
  }

  const agentRef: AgentComposerReference = {
    label,
    refType: entityType,
    refId: entityId,
    metadata: sanitizeMetadata(entityType, metadata),
  };

  if (slotKey) {
    agentRef.slotKey = slotKey;
  }

  if (slotLabel) {
    agentRef.slotLabel = slotLabel;
  }

  if (relatedReferences && relatedReferences.length > 0 && depth < MAX_RELATED_DEPTH) {
    const capped = relatedReferences.slice(0, MAX_RELATED_REFERENCES);
    const convertedRelated = capped
      .map((r) => convertToAgentReference(r, depth + 1))
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