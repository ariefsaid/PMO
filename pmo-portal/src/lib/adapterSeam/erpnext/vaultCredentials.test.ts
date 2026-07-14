import { describe, it, expect, vi } from 'vitest';
import { resolveErpCredentialsFromVault } from './vaultCredentials.ts';
import { AppError } from '../../appError.ts';

describe('resolveErpCredentialsFromVault (AC-EAC-008, AC-EAC-010)', () => {
  it('AC-EAC-010: returns credentials when Vault returns valid apiKey:apiSecret', async () => {
    const mockReadVaultSecret = vi.fn().mockResolvedValue('test-key:test-secret');

    const result = await resolveErpCredentialsFromVault('erpnext_ref_123', mockReadVaultSecret);

    expect(result).toEqual({ apiKey: 'test-key', apiSecret: 'test-secret' });
    expect(mockReadVaultSecret).toHaveBeenCalledWith('erpnext_ref_123');
  });

  it('AC-EAC-008: throws config-rejected when secretRef is blank', async () => {
    const mockReadVaultSecret = vi.fn();

    await expect(resolveErpCredentialsFromVault('', mockReadVaultSecret)).rejects.toThrow(AppError);
    await expect(resolveErpCredentialsFromVault('', mockReadVaultSecret)).rejects.toMatchObject({
      code: 'config-rejected',
    });

    expect(mockReadVaultSecret).not.toHaveBeenCalled();
  });

  it('AC-EAC-008: throws config-rejected when secretRef is whitespace only', async () => {
    const mockReadVaultSecret = vi.fn();

    await expect(resolveErpCredentialsFromVault('   ', mockReadVaultSecret)).rejects.toThrow(AppError);
    await expect(resolveErpCredentialsFromVault('   ', mockReadVaultSecret)).rejects.toMatchObject({
      code: 'config-rejected',
    });
  });

  it('AC-EAC-008: throws config-rejected when Vault returns null', async () => {
    const mockReadVaultSecret = vi.fn().mockResolvedValue(null);

    await expect(resolveErpCredentialsFromVault('valid_ref', mockReadVaultSecret)).rejects.toThrow(AppError);
    await expect(resolveErpCredentialsFromVault('valid_ref', mockReadVaultSecret)).rejects.toMatchObject({
      code: 'config-rejected',
    });
  });

  it('AC-EAC-008: throws config-rejected when Vault returns empty string', async () => {
    const mockReadVaultSecret = vi.fn().mockResolvedValue('');

    await expect(resolveErpCredentialsFromVault('valid_ref', mockReadVaultSecret)).rejects.toThrow(AppError);
    await expect(resolveErpCredentialsFromVault('valid_ref', mockReadVaultSecret)).rejects.toMatchObject({
      code: 'config-rejected',
    });
  });

  it('AC-EAC-008: throws config-rejected when stored value has no colon separator', async () => {
    const mockReadVaultSecret = vi.fn().mockResolvedValue('invalid-format');

    await expect(resolveErpCredentialsFromVault('valid_ref', mockReadVaultSecret)).rejects.toThrow(AppError);
    await expect(resolveErpCredentialsFromVault('valid_ref', mockReadVaultSecret)).rejects.toMatchObject({
      code: 'config-rejected',
    });
  });

  it('AC-EAC-008: throws config-rejected when stored value has empty apiKey', async () => {
    const mockReadVaultSecret = vi.fn().mockResolvedValue(':secret-only');

    await expect(resolveErpCredentialsFromVault('valid_ref', mockReadVaultSecret)).rejects.toThrow(AppError);
    await expect(resolveErpCredentialsFromVault('valid_ref', mockReadVaultSecret)).rejects.toMatchObject({
      code: 'config-rejected',
    });
  });

  it('AC-EAC-008: throws config-rejected when stored value has empty apiSecret', async () => {
    const mockReadVaultSecret = vi.fn().mockResolvedValue('key-only:');

    await expect(resolveErpCredentialsFromVault('valid_ref', mockReadVaultSecret)).rejects.toThrow(AppError);
    await expect(resolveErpCredentialsFromVault('valid_ref', mockReadVaultSecret)).rejects.toMatchObject({
      code: 'config-rejected',
    });
  });

  it('splits only on first colon, allowing colons in secret', async () => {
    const mockReadVaultSecret = vi.fn().mockResolvedValue('api-key:secret:with:colons');

    const result = await resolveErpCredentialsFromVault('valid_ref', mockReadVaultSecret);

    expect(result).toEqual({ apiKey: 'api-key', apiSecret: 'secret:with:colons' });
  });
});