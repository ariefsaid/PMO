import { describe, it, expect, vi } from 'vitest';
import { resolveClickUpCredentialsFromVault } from './vaultCredentials.ts';
import { AppError } from '../../appError.ts';

describe('resolveClickUpCredentialsFromVault (AC-EAC-008, AC-EAC-011)', () => {
  it('AC-EAC-011: returns token when Vault returns valid token', async () => {
    const mockReadVaultSecret = vi.fn().mockResolvedValue('pk_123456789_abcdef');

    const result = await resolveClickUpCredentialsFromVault('clickup_ref_123', mockReadVaultSecret);

    expect(result).toEqual({ token: 'pk_123456789_abcdef' });
    expect(mockReadVaultSecret).toHaveBeenCalledWith('clickup_ref_123');
  });

  it('AC-EAC-008: throws config-rejected when secretRef is blank', async () => {
    const mockReadVaultSecret = vi.fn();

    await expect(resolveClickUpCredentialsFromVault('', mockReadVaultSecret)).rejects.toThrow(AppError);
    await expect(resolveClickUpCredentialsFromVault('', mockReadVaultSecret)).rejects.toMatchObject({
      code: 'config-rejected',
    });

    expect(mockReadVaultSecret).not.toHaveBeenCalled();
  });

  it('AC-EAC-008: throws config-rejected when secretRef is whitespace only', async () => {
    const mockReadVaultSecret = vi.fn();

    await expect(resolveClickUpCredentialsFromVault('   ', mockReadVaultSecret)).rejects.toThrow(AppError);
    await expect(resolveClickUpCredentialsFromVault('   ', mockReadVaultSecret)).rejects.toMatchObject({
      code: 'config-rejected',
    });
  });

  it('AC-EAC-008: throws config-rejected when Vault returns null', async () => {
    const mockReadVaultSecret = vi.fn().mockResolvedValue(null);

    await expect(resolveClickUpCredentialsFromVault('valid_ref', mockReadVaultSecret)).rejects.toThrow(AppError);
    await expect(resolveClickUpCredentialsFromVault('valid_ref', mockReadVaultSecret)).rejects.toMatchObject({
      code: 'config-rejected',
    });
  });

  it('AC-EAC-008: throws config-rejected when Vault returns empty string', async () => {
    const mockReadVaultSecret = vi.fn().mockResolvedValue('');

    await expect(resolveClickUpCredentialsFromVault('valid_ref', mockReadVaultSecret)).rejects.toThrow(AppError);
    await expect(resolveClickUpCredentialsFromVault('valid_ref', mockReadVaultSecret)).rejects.toMatchObject({
      code: 'config-rejected',
    });
  });
});