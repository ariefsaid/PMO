import { describe, it, expect } from 'vitest';
import { companyDisplayName } from './companyDisplayName';
describe('company display name', () => {
  it('prefers the trimmed short name without changing legal identity', () => {
    const company = { name: 'Example Legal Company', short_name: ' Example ' };
    expect(companyDisplayName(company)).toBe('Example');
    expect(company.name).toBe('Example Legal Company');
  });
  it.each([null, undefined, '', '  '])('falls back to the legal name for %s', (short_name) => {
    expect(companyDisplayName({ name: 'Example Legal Company', short_name })).toBe('Example Legal Company');
  });
});
