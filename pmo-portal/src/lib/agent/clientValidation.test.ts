/**
 * Trust-boundary client tests — prove that the compiler the hook calls rejects
 * tampered/invalid specs (ADR-0039 decision 3, FR-AS-022/023).
 *
 * These tests run compileCompositionSpec directly (lowest sufficient layer — no hook/network).
 * They lock the untrusted-output validation boundary as a regression gate (AC-AS-020, AC-AS-021).
 *
 * Reconciliation #1: compileCompositionSpec is fail-fast — it THROWS a single ValidationError,
 * it does NOT return an array of errors.
 */
import { it, expect } from 'vitest';
import { compileCompositionSpec } from '../viewspec/compiler';
import { ValidationError } from '../viewspec/types';
import type { CompositionSpec, CompilerContext } from '../viewspec/types';

const CTX: CompilerContext = { userId: 'u-1', orgId: 'org-1' };

it('AC-AS-020 a composed spec referencing an unknown entity throws UNKNOWN_ENTITY', () => {
  // Simulate a tampered spec where the model (or an attacker) used an entity
  // not present in ENTITY_WHITELIST. The compiler must reject it.
  const tamperedSpec = {
    version: 1,
    panels: [
      {
        id: 'panel-1',
        primitive: 'DataTable',
        querySpec: {
          entity: 'secrets',   // not in ENTITY_WHITELIST
          select: ['id', 'value'],
        },
      },
    ],
  } as unknown as CompositionSpec;

  expect(() => compileCompositionSpec(tamperedSpec, CTX)).toThrow(ValidationError);

  try {
    compileCompositionSpec(tamperedSpec, CTX);
  } catch (err) {
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).code).toBe('UNKNOWN_ENTITY');
  }
});

it('AC-AS-021 a tasks panel with no project_id filter throws MISSING_REQUIRED_FILTER', () => {
  // The tasks entity has requiredFilter: 'project_id'.
  // A spec missing that filter must be rejected — even if the server accepted it.
  const missingFilterSpec: CompositionSpec = {
    version: 1,
    panels: [
      {
        id: 'panel-tasks',
        primitive: 'DataTable',
        querySpec: {
          entity: 'tasks',
          select: ['id', 'name', 'status'],
          // No filters → MISSING_REQUIRED_FILTER
        },
      },
    ],
  };

  expect(() => compileCompositionSpec(missingFilterSpec, CTX)).toThrow(ValidationError);

  try {
    compileCompositionSpec(missingFilterSpec, CTX);
  } catch (err) {
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).code).toBe('MISSING_REQUIRED_FILTER');
  }
});
