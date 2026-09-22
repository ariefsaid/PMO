import { describe, expect, it } from 'vitest';
import { requireLocalErpNextUrl } from './localErpNextUrl';

describe('ERPNext E2E URL guard', () => {
  it('preserves the unconfigured-lane skip when no site URL is provided', () => {
    expect(requireLocalErpNextUrl(undefined)).toBe('');
    expect(requireLocalErpNextUrl('')).toBe('');
    expect(requireLocalErpNextUrl('   ')).toBe('');
  });

  it('accepts only the disposable container-facing bench origin', () => {
    expect(requireLocalErpNextUrl('http://host.docker.internal:8080')).toBe('http://host.docker.internal:8080');
    expect(requireLocalErpNextUrl('http://host.docker.internal:8080/')).toBe('http://host.docker.internal:8080');
  });

  it('rejects remote, alternate-host, alternate-port, and non-http targets', () => {
    for (const url of [
      'https://erp.example.com',
      'http://erp.example.com:8080',
      'http://localhost:8080',
      'http://127.0.0.1:8080',
      'http://host.docker.internal:8081',
      'https://host.docker.internal:8080',
      'not-a-url',
    ]) {
      expect(() => requireLocalErpNextUrl(url)).toThrow('ERPNext fixture setup requires the exact local disposable bench URL');
    }
  });

  it('rejects credentials, paths, queries, and fragments on the approved host', () => {
    for (const url of [
      'http://user:secret@host.docker.internal:8080',
      'http://host.docker.internal:8080/api',
      'http://host.docker.internal:8080?target=remote',
      'http://host.docker.internal:8080#remote',
    ]) {
      expect(() => requireLocalErpNextUrl(url)).toThrow('ERPNext fixture setup requires the exact local disposable bench URL');
    }
  });
});
