export interface ProjectCreator {
  id: string;
  role: string;
  built_in_role?: string | null;
}
export function withDefaultProjectManager<T extends { project_manager_id?: string | null }>(project: T, creator?: ProjectCreator | null): T;
