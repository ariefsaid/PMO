/** The signed-in person's org id — the tenant key every repository read is scoped by. */
import { useAuth } from '@/src/auth/useAuth';

export function useOrgId(): string | undefined {
  return useAuth().currentUser?.org_id;
}
