/**
 * activityLabel unit tests — the activity trail's friendly present-tense phrasing.
 *
 * The raw step label ("Looking up projects…") is backend-driven (stepLabel in the
 * agent-chat handler). `friendlyActivity` rephrases it for the persistent trail so a
 * long run reads as reassuring, transparent progress rather than opaque jargon.
 * Pure function; never an authorization or persistence input.
 */
import { describe, it, expect } from 'vitest';
import { friendlyActivity } from './activityLabel';

describe('friendlyActivity', () => {
  it('maps known query_entity targets to friendlier copy', () => {
    expect(friendlyActivity('Looking up projects…')).toBe('Checking your projects');
    expect(friendlyActivity('Looking up crm activities…')).toBe('Looking for CRM activity');
    expect(friendlyActivity('Looking up tasks…')).toBe('Checking tasks');
    expect(friendlyActivity('Looking up companies…')).toBe('Checking companies');
    expect(friendlyActivity('Looking up purchase orders…')).toBe('Checking purchase orders');
  });

  it('falls back to "Looking up <entity>" for an unmapped entity', () => {
    expect(friendlyActivity('Looking up widgets…')).toBe('Looking up widgets');
  });

  it('strips the trailing ellipsis for non-lookup step labels', () => {
    expect(friendlyActivity('Logging an activity…')).toBe('Logging an activity');
    expect(friendlyActivity('Updating a task…')).toBe('Updating a task');
    expect(friendlyActivity('Building a view…')).toBe('Building a view');
    expect(friendlyActivity('Working…')).toBe('Working');
  });

  it('passes through labels that have no trailing ellipsis unchanged', () => {
    expect(friendlyActivity('Thinking')).toBe('Thinking');
  });
});
