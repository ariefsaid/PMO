/** Returns the route to the related object for an activity, or null when neither id is set.
 *  project_id takes precedence over company_id (a project is more specific context). */
export const hrefForActivity = (a: { project_id: string | null; company_id: string | null }): string | null => {
  if (a.project_id) return `/projects/${a.project_id}`;
  if (a.company_id) return `/companies/${a.company_id}`;
  return null;
};
