/**
 * COMPOSITION_SPEC_SCHEMA — JSON Schema for the compose_view tool input_schema.
 *
 * Enums are built FROM registry.keys() and Object.keys(ENTITY_WHITELIST) — no hardcoded
 * primitive/entity names (FR-AS-024 defense-in-depth: the tool schema constrains the model
 * to whitelist values; the compiler remains the enforcement authority).
 *
 * Imported by both:
 *   - handler.ts (Deno runtime) — used as tool parameters schema for model tool-forcing
 *   - pmo-portal/src/lib/agent/schema.test.ts (Node/Vitest) — via relative path (Option B)
 *
 * ADR-0039 decision 7: this is a pure TS module with no Deno/Node runtime dependencies,
 * importable in both environments.
 */

// Relative imports back into the trusted core.
// No .ts extension: Vite/Node resolves TypeScript modules without extensions;
// Deno (when using a deno.json import map) will map these via the importmap entry.
import { registry } from '../../../pmo-portal/src/lib/viewspec/registry';
import {
  ENTITY_WHITELIST,
  MAX_PANELS_PER_VIEW,
} from '../../../pmo-portal/src/lib/viewspec/types';

/**
 * JSON Schema for CompositionSpec v1.
 * Used as the `input_schema` for the `compose_view` tool (FR-AS-005, FR-AS-006).
 * maxItems = MAX_PANELS_PER_VIEW (shared constant, FR-AS-004).
 */
export const COMPOSITION_SPEC_SCHEMA = {
  type: 'object' as const,
  required: ['version', 'panels'] as string[],
  additionalProperties: false,
  properties: {
    version: {
      type: 'integer' as const,
      const: 1,
      description: 'CompositionSpec version — always 1 in this schema.',
    },
    panels: {
      type: 'array' as const,
      maxItems: MAX_PANELS_PER_VIEW,
      description: `Array of panel specs. Maximum ${MAX_PANELS_PER_VIEW} panels.`,
      items: {
        type: 'object' as const,
        required: ['id', 'primitive', 'querySpec'] as string[],
        additionalProperties: false,
        properties: {
          id: {
            type: 'string' as const,
            description: 'Stable, unique panel identifier (e.g. a UUID or slug).',
          },
          primitive: {
            type: 'string' as const,
            // Built from registry.keys() — FR-AS-024 defense-in-depth
            enum: registry.keys(),
            description: 'Name of the registered UI primitive to render this panel.',
          },
          querySpec: {
            type: 'object' as const,
            required: ['entity', 'select'] as string[],
            additionalProperties: false,
            properties: {
              entity: {
                type: 'string' as const,
                // Built from Object.keys(ENTITY_WHITELIST) — FR-AS-024 defense-in-depth
                enum: Object.keys(ENTITY_WHITELIST),
                description: 'Whitelisted entity to query.',
              },
              select: {
                type: 'array' as const,
                items: { type: 'string' as const },
                description: 'Column names to select (must be in entity allowedColumns).',
              },
              filters: {
                type: 'array' as const,
                items: {
                  type: 'object' as const,
                  required: ['column', 'op', 'value'] as string[],
                  properties: {
                    column: { type: 'string' as const },
                    op: {
                      type: 'string' as const,
                      enum: ['eq', 'neq', 'in', 'gt', 'gte', 'lt', 'lte', 'between', 'date-range'],
                    },
                    value: {
                      description: 'Filter value — string, number, boolean, or array.',
                    },
                  },
                },
              },
              groupBy: {
                type: 'string' as const,
                description: 'Column to group by (must be in entity groupableColumns).',
              },
              aggregate: {
                type: 'object' as const,
                required: ['fn', 'column', 'alias'] as string[],
                properties: {
                  fn: {
                    type: 'string' as const,
                    enum: ['count', 'sum', 'avg', 'min', 'max'],
                  },
                  column: { type: 'string' as const },
                  alias: { type: 'string' as const },
                },
              },
              timeRange: {
                type: 'object' as const,
                required: ['column', 'from', 'to'] as string[],
                properties: {
                  column: { type: 'string' as const },
                  from: { type: 'string' as const },
                  to: { type: 'string' as const },
                },
              },
              limit: {
                type: 'integer' as const,
                minimum: 1,
              },
              orderBy: {
                type: 'object' as const,
                required: ['column', 'dir'] as string[],
                properties: {
                  column: { type: 'string' as const },
                  dir: {
                    type: 'string' as const,
                    enum: ['asc', 'desc'],
                  },
                },
              },
            },
          },
          layout: {
            type: 'object' as const,
            properties: {
              colSpan: { type: 'integer' as const, minimum: 1 },
              rowSpan: { type: 'integer' as const, minimum: 1 },
            },
          },
          props: {
            type: 'object' as const,
            description: 'Static primitive props (tone, icon, label, etc.).',
          },
        },
      },
    },
  },
};
