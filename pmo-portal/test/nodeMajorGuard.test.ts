// #2215: Vitest refuses to run on a Node major other than the one in package.json `engines`.
import { describe, expect, it } from 'vitest';
import { assertNodeMajor, expectedNodeMajor } from './nodeMajorGuard';

describe('nodeMajorGuard (#2215)', () => {
  it('reads the major from an engines range', () => {
    expect(expectedNodeMajor('>=22.22.0')).toBe(22);
    expect(expectedNodeMajor('^24.1.0')).toBe(24);
  });

  it('throws on an unparseable engines range', () => {
    expect(() => expectedNodeMajor('latest')).toThrow(/engines/);
  });

  it('accepts the expected major', () => {
    expect(() => assertNodeMajor('22.23.4', '>=22.22.0')).not.toThrow();
  });

  it('fails at once with a one-line message naming the expected major', () => {
    let message = '';
    try {
      assertNodeMajor('26.0.0', '>=22.22.0');
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('Node 22');
    expect(message).toContain('26');
    expect(message.includes('\n')).toBe(false);
  });
});
