/**
 * Inverts a binding's PMO project ID → ERP project name map. Duplicate ERP names have
 * no unique PMO target and therefore resolve to null instead of whichever entry is last.
 */
export function invertProjectMap(
  projectMap: Readonly<Record<string, unknown>> | undefined,
): ReadonlyMap<string, string | null> {
  const inverse = new Map<string, string | null>();
  for (const [pmoProjectId, erpName] of Object.entries(projectMap ?? {})) {
    if (typeof erpName !== 'string' || erpName === '') continue;
    inverse.set(erpName, inverse.has(erpName) ? null : pmoProjectId);
  }
  return inverse;
}
