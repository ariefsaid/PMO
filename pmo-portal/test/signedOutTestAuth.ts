import type { AuthContextValue } from '@/src/auth/AuthContext';

/**
 * Neutral signed-out auth for test renders (shared with renderWithQueryClient): no session and no user,
 * so org-scoped reads stay disabled exactly as an anonymous render sees them. Suites that need a signed-in
 * user mock `@/src/auth/useAuth` themselves, which takes precedence over this context value.
 */
export function signedOutAuth(): AuthContextValue {
  return {
    session: null,
    currentUser: null,
    role: null,
    loading: false,
    profileError: null,
    profileErrorKind: null,
    signInWithPassword: async () => ({ error: null }),
    signInWithMagicLink: async () => ({ error: null }),
    signInWithMicrosoft: async () => ({ error: null }),
    requestPasswordReset: async () => ({ error: null }),
    updatePassword: async () => ({ error: null }),
    resendEmailConfirmation: async () => ({ error: null }),
    signOut: async () => undefined,
    refreshCurrentUser: async () => ({ error: null }),
  };
}
