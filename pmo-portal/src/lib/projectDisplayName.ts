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
 * Scan order for a project option list (C18): the label a person actually reads (`short_name ?? name`),
 * case- and accent-insensitive with numeric runs compared as numbers ("Phase 9" before "Phase 10"), and
 * the stable id as the last key so two equal titles keep a deterministic order. The read is paged by
 * `id` (a total order is required there, #1774), so a picker must not inherit that order.
 */
export function compareProjectOptions(
  a: ProjectDisplayIdentity & { id: string },
  b: ProjectDisplayIdentity & { id: string },
): number {
  const byLabel = projectDisplayName(a).localeCompare(projectDisplayName(b), undefined, {
    sensitivity: 'base',
    numeric: true,
  });
  return byLabel !== 0 ? byLabel : a.id.localeCompare(b.id);
}

/** `compareProjectOptions` over a copy: the picker's rows are never reordered in place. */
export function sortProjectOptions<T extends ProjectDisplayIdentity & { id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort(compareProjectOptions);
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
