/** The signed-in person's org id — the tenant key every repository read is scoped by. */
import { useContext } from 'react';
import { AuthContext } from '@/src/auth/AuthContext';
import { useAuth } from '@/src/auth/useAuth';

export function useOrgId(): string | undefined {
  return useAuth().currentUser?.org_id;
}

/**
 * The org id without requiring a provider: undefined when there is no auth provider or no session, never a throw.
 * For reads that sit on shared chrome rendered beside optional features — the screen simply shows nothing new when
 * the feature is unmounted (useLeave, the stock reservation reads).
 */
export function useOptionalOrgId(): string | undefined {
  return useContext(AuthContext)?.currentUser?.org_id;
}
