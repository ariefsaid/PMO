import type { ImportDescriptor } from './types';

const PREFIX = 'pmo-import-template';

/** The marker stored in a template's workbook properties: which sheet and which version it was made from. */
export function templateMarker(d: Pick<ImportDescriptor<never>, 'entity' | 'template'>): string {
  return `${PREFIX}:${d.entity}:v${d.template?.version ?? 0}`;
}

/**
 * `outOfDate` only when the file is a template for THIS entity at a version other than the current or the one
 * before it. A file with no marker (the person's own sheet) or another entity's marker is read as before.
 */
export function checkTemplateMarker(d: Pick<ImportDescriptor<never>, 'entity' | 'template'>, marker: string | null | undefined): 'ok' | 'outOfDate' {
  if (!d.template || !marker) return 'ok';
  const m = new RegExp(`^${PREFIX}:(.*):v(\\d+)$`).exec(marker);
  if (!m || m[1] !== d.entity) return 'ok';
  const v = Number(m[2]);
  return v === d.template.version || v === d.template.version - 1 ? 'ok' : 'outOfDate';
}
