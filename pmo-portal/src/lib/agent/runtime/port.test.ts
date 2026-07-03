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

it('AC-ATC-011 control verb set is a superset, answer added, no existing member changed', () => {
  type Cmd = Parameters<import('./port').AgentRuntime['control']>[1];
  // Every existing verb still assignable (no member removed/renamed):
  const existing: Cmd[] = ['pause', 'resume', 'cancel', 'approve', 'reject'];
  const added: Cmd = 'answer'; // new member present
  expect([...existing, added]).toHaveLength(6);
  // @ts-expect-error — a non-member is still rejected (union not widened to string)
  const bogus: Cmd = 'delete-everything';
  void bogus;
});
