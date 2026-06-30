/**
 * Vitest gate-tests for the viewspec types module.
 * AC-### tags in each it() title are the traceability anchors (ADR-0010).
 */
import { it, expect } from 'vitest';
import { MAX_PANELS_PER_VIEW } from './types';

it('MAX_PANELS_PER_VIEW is 20 (shared cap, FR-AS-004)', () => {
  expect(MAX_PANELS_PER_VIEW).toBe(20);
});
