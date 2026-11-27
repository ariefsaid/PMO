/** An Admin names the journey's Project Manager on its disposable project. */
export function managedProject<T extends object>(managerId: string, project: T): T & { project_manager_id: string } {
  return { ...project, project_manager_id: managerId };
}
