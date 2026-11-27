/** The creator's default is a convenience; an explicitly named manager always wins. */
export function withDefaultProjectManager(project, creator) {
  const isManager = creator?.role === 'Project Manager'
    && (!creator.built_in_role || creator.built_in_role === 'project_manager');
  if (project.project_manager_id || !isManager || !creator.id) return project;
  return { ...project, project_manager_id: creator.id };
}
