import type { ClickUpListItem, ProjectBinding } from './types';

export type TaskListMatchState = 'proposed' | 'ambiguous' | 'unresolved' | 'accepted';

export interface TaskListMatchProposal {
  projectId: string;
  listId: string | null;
  state: TaskListMatchState;
}

export function proposeTaskListMatches(
  projects: readonly { id: string; name: string }[],
  lists: readonly ClickUpListItem[],
  accepted: readonly ProjectBinding[],
): TaskListMatchProposal[] {
  const activeBindings = accepted.filter(
    (binding) => binding.external_tier === 'clickup' && binding.disconnected_at === null,
  );
  const bindingByProjectId = new Map(activeBindings.map((binding) => [binding.project_id, binding]));
  const boundListIds = new Set(activeBindings.map((binding) => binding.external_container_id));

  return projects.map((project) => {
    const existing = bindingByProjectId.get(project.id);
    if (existing) {
      return {
        projectId: project.id,
        listId: existing.external_container_id,
        state: 'accepted',
      };
    }

    const name = project.name.trim();
    const matches = name ? lists.filter((list) => list.name.trim() === name) : [];
    if (matches.length > 1) {
      return { projectId: project.id, listId: null, state: 'ambiguous' };
    }

    const match = matches[0];
    if (!match || boundListIds.has(match.id)) {
      return { projectId: project.id, listId: null, state: 'unresolved' };
    }

    return { projectId: project.id, listId: match.id, state: 'proposed' };
  });
}
