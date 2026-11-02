/**
 * Vitest gate-tests for the viewspec types module.
 * AC-### tags in each it() title are the traceability anchors (ADR-0010).
 */
import { it, expect } from 'vitest';
import { FILTER_OP_VALUES, MAX_PANELS_PER_VIEW, TOKEN_VALUES, VALID_FILTER_OPS, VALID_TOKENS } from './types';

it('MAX_PANELS_PER_VIEW is 20 (shared cap, FR-AS-004)', () => {
  expect(MAX_PANELS_PER_VIEW).toBe(20);
});

it('runtime token and operator sets derive from their typed vocabularies', () => {
  expect([...VALID_TOKENS]).toEqual(TOKEN_VALUES);
  expect([...VALID_FILTER_OPS]).toEqual(FILTER_OP_VALUES);
});
