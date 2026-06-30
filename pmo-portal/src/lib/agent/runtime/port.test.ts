/**
 * Port module purity guard.
 * FR-AR-001: the port exports no runtime values (types only).
 * NFR-AR-SEC-007: no adapter can be in the port file.
 */
import * as Port from './port';
import { it, expect } from 'vitest';

it('port.ts exports no runtime values (types only)', () => {
  // All exports from port.ts are TypeScript types/interfaces which are erased
  // at runtime — the module object should have zero enumerable keys.
  expect(Object.keys(Port)).toHaveLength(0);
});
