export interface ProjectDisplayIdentity {
  name: string;
  short_name?: string | null;
}

/** Human-facing project title; the stored `name` remains the contractual identity. */
export function projectDisplayName(project: ProjectDisplayIdentity): string {
  return project.short_name?.trim() || project.name;
}

/** Native-select label that keeps the contractual name available beside a distinct alias. */
export function projectPickerLabel(project: ProjectDisplayIdentity): string {
  const display = projectDisplayName(project);
  return display === project.name ? display : `${display} — ${project.name}`;
}
