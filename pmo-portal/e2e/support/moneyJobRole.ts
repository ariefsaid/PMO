import { jobRoleUser } from './jobRole';

/** Compatibility entry point for money journeys that clean up their own records. */
export async function moneyJobRole(jobRole: string, role = 'Engineer') {
  const actor = await jobRoleUser({ jobRole, role });
  return { id: actor.id, login: actor.signIn, cleanup: actor.removeLogin };
}
