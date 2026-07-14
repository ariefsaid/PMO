/**
 * erpnext/credentials.ts (Slice 6 pre-task): per-org credential resolution (NFR-ENA-SEC-002). The
 * `external_org_bindings.secret_ref` NAMES a per-org function-secret pair — it never stores a secret
 * value. `resolveErpCredentials(secretRef, getEnv)` derives an env-safe prefix from the ref and reads
 * `<PREFIX>_KEY` / `<PREFIX>_SECRET` from the injected env, failing CLOSED (`config-rejected`) when
 * either is unset — replacing the flagged single global `ERPNEXT_API_KEY` placeholder in index.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../appError.ts';
import { resolveErpCredentials, secretRefEnvPrefix } from './credentials.ts';

describe('erpnext/credentials', () => {
  it('derives an env-safe UPPER_SNAKE prefix from a secret_ref (hyphens/slashes -> underscores)', () => {
    expect(secretRefEnvPrefix('local-bench')).toBe('LOCAL_BENCH');
    expect(secretRefEnvPrefix('vault/AS/erpnext-org-1')).toBe('VAULT_AS_ERPNEXT_ORG_1');
  });

  it('resolves {apiKey, apiSecret} from <PREFIX>_KEY / <PREFIX>_SECRET for the ref', () => {
    const env = new Map([
      ['LOCAL_BENCH_KEY', 'k-123'],
      ['LOCAL_BENCH_SECRET', 's-456'],
    ]);
    const creds = resolveErpCredentials('local-bench', (k) => env.get(k));
    expect(creds).toEqual({ apiKey: 'k-123', apiSecret: 's-456' });
  });

  it('resolves per-org: a different secret_ref reads a DIFFERENT env pair (not a single global)', () => {
    const env = new Map([
      ['ORG_A_KEY', 'ka'],
      ['ORG_A_SECRET', 'sa'],
      ['ORG_B_KEY', 'kb'],
      ['ORG_B_SECRET', 'sb'],
    ]);
    expect(resolveErpCredentials('org-a', (k) => env.get(k))).toEqual({ apiKey: 'ka', apiSecret: 'sa' });
    expect(resolveErpCredentials('org-b', (k) => env.get(k))).toEqual({ apiKey: 'kb', apiSecret: 'sb' });
  });

  it('fails CLOSED with a generic message and server-side diagnostic when the KEY env var is unset', () => {
    const env = new Map([['LOCAL_BENCH_SECRET', 's-456']]);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      resolveErpCredentials('local-bench', (k) => env.get(k));
      throw new Error('expected resolveErpCredentials to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('config-rejected');
      expect((err as AppError).message).toBe('ERPNext credentials unresolved for this org — check the binding secret_ref configuration');
      expect((err as AppError).message).not.toContain('LOCAL_BENCH_KEY');
      expect(errorSpy).toHaveBeenCalledWith('ERPNext credential resolution failed', {
        secretRef: 'local-bench', keyEnv: 'LOCAL_BENCH_KEY', secretEnv: 'LOCAL_BENCH_SECRET',
      });
    }
    errorSpy.mockRestore();
  });

  it('fails CLOSED (config-rejected) when the SECRET env var is unset', () => {
    const env = new Map([['LOCAL_BENCH_KEY', 'k-123']]);
    expect(() => resolveErpCredentials('local-bench', (k) => env.get(k))).toThrow(AppError);
  });

  it('fails CLOSED (config-rejected) when the ref is empty', () => {
    expect(() => resolveErpCredentials('', () => undefined)).toThrow(/config-rejected|secret_ref/);
  });
});
