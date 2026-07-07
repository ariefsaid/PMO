/**
 * stepLabel unit tests — the live step-trail's present-tense tool label (purely cosmetic).
 *
 * Powers the assistant panel's ephemeral status line ("Looking up projects…" etc.) shown
 * while each tool runs. Pure function; never an authorization or persistence input, so the
 * unit test exercises it directly without the handler/deps harness.
 */
import { describe, it, expect } from 'vitest';
import { stepLabel } from '../../../../supabase/functions/agent-chat/handler';

describe('stepLabel', () => {
  it('query_entity with an entity → "Looking up <humanized entity>…"', () => {
    expect(stepLabel('query_entity', { entity: 'projects' })).toBe('Looking up projects…');
  });

  it('query_entity snake_cases an entity for readability', () => {
    expect(stepLabel('query_entity', { entity: 'crm_activities' })).toBe('Looking up crm activities…');
  });

  it('query_entity without an entity → a generic lookup line', () => {
    expect(stepLabel('query_entity', {})).toBe('Looking up your data…');
    expect(stepLabel('query_entity', undefined)).toBe('Looking up your data…');
  });

  it('create_activity → "Logging an activity…"', () => {
    expect(stepLabel('create_activity', {})).toBe('Logging an activity…');
  });

  it('update_task_status → "Updating a task…"', () => {
    expect(stepLabel('update_task_status', {})).toBe('Updating a task…');
  });

  it('compose_view → "Building a view…"', () => {
    expect(stepLabel('compose_view', {})).toBe('Building a view…');
  });

  it('create_automation → "Setting up an automation…"', () => {
    expect(stepLabel('create_automation', {})).toBe('Setting up an automation…');
  });

  it('notify → "Preparing a notification…"', () => {
    expect(stepLabel('notify', {})).toBe('Preparing a notification…');
  });

  it('unknown tool → the neutral "Working…" fallback', () => {
    expect(stepLabel('something_new', {})).toBe('Working…');
    expect(stepLabel('', {})).toBe('Working…');
  });
});
