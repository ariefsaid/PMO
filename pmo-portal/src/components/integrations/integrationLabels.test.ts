import { describe, it, expect } from 'vitest';
import { tierLabel, domainLabel } from './integrationLabels';

describe('OD-EAS-LABELS the display-label map converts raw slugs to human labels', () => {
  describe('tierLabel', () => {
    it('tierLabel("clickup") returns "ClickUp"', () => {
      expect(tierLabel('clickup')).toBe('ClickUp');
    });

    it('tierLabel falls back to raw slug for unknown tiers', () => {
      expect(tierLabel('unknown_tier')).toBe('unknown_tier');
      expect(tierLabel('')).toBe('');
    });
  });

  describe('domainLabel', () => {
    it('domainLabel("tasks") returns "Tasks"', () => {
      expect(domainLabel('tasks')).toBe('Tasks');
    });

    it('domainLabel falls back to raw slug for unknown domains', () => {
      expect(domainLabel('unknown_domain')).toBe('unknown_domain');
      expect(domainLabel('')).toBe('');
    });
  });
});