export interface ProjectDisplayIdentity {
  name: string;
  short_name?: string | null;
}

/** Human-facing project title; the stored `name` remains the contractual identity. */
export function projectDisplayName(project: ProjectDisplayIdentity): string {
  return project.short_name?.trim() || project.name;
}

/** Combobox secondary line: the contractual title (only when an alias replaces it) then the client code. */
export function projectOptionSub(project: ProjectDisplayIdentity & { code?: string | null }): string | undefined {
  const legal = projectDisplayName(project) !== project.name ? project.name : null;
  return [legal, project.code].filter(Boolean).join(' · ') || undefined;
}

/**
 * Native-select label `code · title`. The short name is shown alone; an unaliased contractual name is
 * cut to `maxName` characters with an ellipsis when the caller asks (RF-061: long titles bloat the select).
 */
export function projectCodedPickerLabel(
  project: ProjectDisplayIdentity & { code?: string | null },
  maxName?: number,
): string {
  const display = projectDisplayName(project);
  const aliased = display !== project.name;
  const title = !aliased && maxName && display.length > maxName ? `${display.slice(0, maxName - 1).trimEnd()}…` : display;
  return project.code ? `${project.code} · ${title}` : title;
}
