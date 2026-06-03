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
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithMagicLink: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);
