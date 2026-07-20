import { createContext } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Tables } from '@/src/lib/supabase/database.types';

export type Profile = Tables<'profiles'>;
export type Role = Profile['role'];

export interface AuthContextValue {
  session: Session | null;
  currentUser: Profile | null;
  role: Role | null;
  loading: boolean;
  /** Non-null when a session exists but the profiles row could not be loaded. */
  profileError: string | null;
  /**
   * Discriminates why `profileError` is set:
   *  - 'not_provisioned' — the session is valid but no `profiles` row exists yet
   *    (e.g. SSO sign-in before the user was invited to an org). Retrying can't help.
   *  - 'load_error' — a transient/generic failure while fetching the profile row.
   *    Retrying may help.
   * `null` when `profileError` is null.
   */
  profileErrorKind: 'not_provisioned' | 'load_error' | null;
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithMagicLink: (email: string) => Promise<{ error: string | null }>;
  /** Microsoft Entra ID (work/school) sign-in via the Supabase `azure` OAuth provider. */
  signInWithMicrosoft: () => Promise<{ error: string | null }>;
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (password: string) => Promise<{ error: string | null }>;
  resendEmailConfirmation: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);
