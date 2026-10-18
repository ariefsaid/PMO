import { describe, expect, it } from 'vitest';
import type { ClickUpListItem, ProjectBinding } from './types';
import { proposeTaskListMatches } from './taskListMatchReview';

const projects = [
  { id: 'project-1', name: '  Northwind Retrofit  ' },
  { id: 'project-2', name: 'Northwind Retrofitt' },
  { id: 'project-3', name: 'NORTHWIND RETROFIT' },
];

const lists: ClickUpListItem[] = [
  { id: 'list-exact', name: 'Northwind Retrofit', space_name: 'Delivery', folder_name: null },
  { id: 'list-duplicate', name: 'Northwind Retrofitt', space_name: 'Delivery', folder_name: null },
  { id: 'list-duplicate-2', name: ' Northwind Retrofitt ', space_name: 'Operations', folder_name: 'Current' },
  { id: 'list-close', name: 'Northwind Retrofit 2026', space_name: 'Delivery', folder_name: null },
];

const accepted = (projectId: string, listId: string): ProjectBinding => ({
  id: `binding-${projectId}`,
  org_id: 'org-1',
  project_id: projectId,
  external_tier: 'clickup',
  external_container_id: listId,
  config: { direction: 'pull-adopt' },
  linked_by: 'user-1',
  linked_at: '2026-01-02T00:00:00Z',
  disconnected_at: null,
});

describe('proposeTaskListMatches', () => {
  it('AC-S21-002 proposes a stable existing list ID only for a unique trimmed exact name', () => {
    expect(proposeTaskListMatches(projects, lists, [])).toEqual([
      { projectId: 'project-1', listId: 'list-exact', state: 'proposed' },
      { projectId: 'project-2', listId: null, state: 'ambiguous' },
      { projectId: 'project-3', listId: null, state: 'unresolved' },
    ]);
  });

  it('AC-S21-002 keeps duplicate name matches ambiguous instead of choosing by order', () => {
    const result = proposeTaskListMatches([projects[1]], lists, []);

    expect(result).toEqual([{ projectId: 'project-2', listId: null, state: 'ambiguous' }]);
  });

  it('AC-S21-002 leaves close but non-exact names unresolved instead of fuzzy matching', () => {
    expect(proposeTaskListMatches([projects[0]], [lists[3]], [])).toEqual([
      { projectId: 'project-1', listId: null, state: 'unresolved' },
    ]);
  });

  it('AC-S21-002 leaves a list already bound to another project unresolved', () => {
    expect(proposeTaskListMatches(
      [{ id: 'project-new', name: 'Northwind Retrofit' }],
      [lists[0]],
      [accepted('project-bound', 'list-exact')],
    )).toEqual([
      { projectId: 'project-new', listId: null, state: 'unresolved' },
    ]);
  });

  it('AC-S21-002 retains an accepted stable list ID even when that list is currently unavailable', () => {
    const result = proposeTaskListMatches(
      [projects[0]],
      [],
      [accepted('project-1', 'list-accepted-but-unavailable')],
    );

    expect(result).toEqual([
      { projectId: 'project-1', listId: 'list-accepted-but-unavailable', state: 'accepted' },
    ]);
  });
});
