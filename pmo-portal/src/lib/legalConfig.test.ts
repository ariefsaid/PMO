import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('legalConfig (AC-LEG-005, AC-LEG-008, AC-LEG-034)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('AC-LEG-005 / AC-LEG-034-default: exports the five typed constants with presentable defaults when env unset', async () => {
    // No stubs → every VITE_LEGAL_* is undefined → presentable defaults (never a bracket).
    const mod = await import('./legalConfig');
    expect(mod.LEGAL_ENTITY_NAME).toBe('PMO Portal');
    expect(mod.DOMAIN).toBe('pmoportal.app');
    expect(mod.CONTACT_EMAIL).toBe('support@pmoportal.app');
    expect(mod.HELP_WHATSAPP).toBe('');
    expect(mod.HOSTING_LOCATION).toBe('Singapore');
  });

  it('AC-LEG-034-override: reads VITE_LEGAL_* overrides from import.meta.env', async () => {
    vi.stubEnv('VITE_LEGAL_ENTITY_NAME', 'Acme Pty Ltd');
    vi.stubEnv('VITE_LEGAL_DOMAIN', 'acme.example');
    vi.stubEnv('VITE_LEGAL_CONTACT_EMAIL', 'legal@acme.example');
    vi.stubEnv('VITE_HELP_WHATSAPP', '6281234567890');
    vi.stubEnv('VITE_HOSTING_LOCATION', 'Jakarta');
    const mod = await import('./legalConfig');
    expect(mod.LEGAL_ENTITY_NAME).toBe('Acme Pty Ltd');
    expect(mod.DOMAIN).toBe('acme.example');
    expect(mod.CONTACT_EMAIL).toBe('legal@acme.example');
    expect(mod.HELP_WHATSAPP).toBe('6281234567890');
    expect(mod.HOSTING_LOCATION).toBe('Jakarta');
  });

  it('AC-LEG-008: HELP_URL is https://wa.me/<E.164> when HELP_WHATSAPP set', async () => {
    vi.stubEnv('VITE_HELP_WHATSAPP', '6281234567890');
    const mod = await import('./legalConfig');
    expect(mod.HELP_URL).toBe('https://wa.me/6281234567890');
  });

  it('AC-LEG-008 / FR-LEG-010: HELP_URL is empty (Help omitted) when HELP_WHATSAPP unset', async () => {
    const mod = await import('./legalConfig');
    expect(mod.HELP_WHATSAPP).toBe('');
    expect(mod.HELP_URL).toBe('');
  });

  it('AC-LEG-005: all five constants are typed as string', async () => {
    const mod = await import('./legalConfig');
    for (const v of [
      mod.LEGAL_ENTITY_NAME,
      mod.DOMAIN,
      mod.CONTACT_EMAIL,
      mod.HELP_WHATSAPP,
      mod.HOSTING_LOCATION,
      mod.HELP_URL,
    ]) {
      expect(typeof v).toBe('string');
    }
  });
});
