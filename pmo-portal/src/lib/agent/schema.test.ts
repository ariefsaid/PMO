/**
 * Unit tests for COMPOSITION_SPEC_SCHEMA (the JSON Schema for the compose_view tool input_schema).
 * Imports the schema from the edge function by relative path (Option B — no vitest.config change).
 * AC-### tags in each it() title are the traceability anchors (ADR-0010).
 *
 * FR-AS-024: enums are built FROM registry.keys() / Object.keys(ENTITY_WHITELIST) —
 * no hardcoded primitive/entity names in the schema.
 */
import { it, expect } from 'vitest';
import { COMPOSITION_SPEC_SCHEMA } from '../../../../supabase/functions/compose-view/schema';
import { registry } from '../viewspec/registry';
import { ENTITY_WHITELIST, MAX_PANELS_PER_VIEW } from '../viewspec/types';

it('COMPOSITION_SPEC_SCHEMA describes version literal 1 and a panels array', () => {
  expect(COMPOSITION_SPEC_SCHEMA.type).toBe('object');
  expect(COMPOSITION_SPEC_SCHEMA.required).toContain('version');
  expect(COMPOSITION_SPEC_SCHEMA.required).toContain('panels');
  expect(COMPOSITION_SPEC_SCHEMA.properties.version.const).toBe(1);
  expect(COMPOSITION_SPEC_SCHEMA.properties.panels.type).toBe('array');
  expect(COMPOSITION_SPEC_SCHEMA.properties.panels.maxItems).toBe(MAX_PANELS_PER_VIEW);
});

it('panel items enumerate only registry primitives and whitelist entities', () => {
  const panelItems = COMPOSITION_SPEC_SCHEMA.properties.panels.items;

  // primitive enum must equal registry.keys() exactly
  const primitiveEnum: string[] = panelItems.properties.primitive.enum;
  const registryKeys = registry.keys();
  expect(primitiveEnum).toEqual(registryKeys);

  // entity enum must equal Object.keys(ENTITY_WHITELIST) exactly
  const entityEnum: string[] = panelItems.properties.querySpec.properties.entity.enum;
  const whitelistKeys = Object.keys(ENTITY_WHITELIST);
  expect(entityEnum).toEqual(whitelistKeys);
});
