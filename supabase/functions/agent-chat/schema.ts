/**
 * QUERY_ENTITY_SCHEMA — JSON Schema for the query_entity tool input_schema.
 *
 * D3/R1: plain JSON Schema object, NOT Zod. Mirrors compose-view/schema.ts style.
 * Enum is built from AGENT_READ_ENTITIES (projects, companies — D5).
 * Importable in both Deno (edge function) and Node/Vitest (co-located tests).
 *
 * FR-AR-009: the schema constrains the model's tool inputs; the action validates them.
 */

import { AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP } from './actions';

// ── Write action schemas (A3) ─────────────────────────────────────────────────

export const CREATE_ACTIVITY_SCHEMA = {
  type: 'object' as const,
  required: ['contactId', 'kind', 'subject'] as string[],
  additionalProperties: false,
  properties: {
    contactId: { type: 'string' as const, description: "Parent contact id (the caller's own org)." },
    kind: {
      type: 'string' as const,
      enum: ['call', 'email', 'meeting', 'note'] as string[],
      description: 'Activity kind.',
    },
    subject: { type: 'string' as const, maxLength: 200, description: 'Short subject line.' },
    body: { type: 'string' as const, maxLength: 2000, description: 'Optional detail.' },
    occurredAt: { type: 'string' as const, description: 'ISO-8601; defaults to now if omitted.' },
  },
};

export const UPDATE_TASK_STATUS_SCHEMA = {
  type: 'object' as const,
  required: ['taskId', 'status'] as string[],
  additionalProperties: false,
  properties: {
    taskId: { type: 'string' as const, description: "Task id (the caller's own org)." },
    status: {
      type: 'string' as const,
      enum: ['To Do', 'In Progress', 'Done', 'Blocked'] as string[],
      description: 'New task status.',
    },
  },
};

export const QUERY_ENTITY_SCHEMA = {
  type: 'object' as const,
  required: ['entity'] as string[],
  additionalProperties: false,
  properties: {
    entity: {
      type: 'string' as const,
      enum: AGENT_READ_ENTITIES as unknown as string[],
      description:
        "Whitelisted entity to read (the caller's own rows only — RLS-scoped).",
    },
    columns: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description:
        "Subset of the entity's allowed columns; omit for all allowed columns.",
    },
    filter: {
      type: 'object' as const,
      required: ['column', 'op', 'value'] as string[],
      additionalProperties: false,
      properties: {
        column: { type: 'string' as const },
        op: {
          type: 'string' as const,
          enum: ['eq', 'in'],
          description: 'Filter operator: eq (equality) or in (list membership).',
        },
        value: {
          description: 'eq → scalar string; in → array of strings.',
        },
      },
    },
    limit: {
      type: 'integer' as const,
      minimum: 1,
      maximum: AGENT_READ_ROW_CAP,
      description: `Maximum rows to return. Hard cap is ${AGENT_READ_ROW_CAP}.`,
    },
  },
};
