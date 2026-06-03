import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url) throw new Error('Missing VITE_SUPABASE_URL — copy .env.example to .env.local and set it.');
if (!anonKey) throw new Error('Missing VITE_SUPABASE_ANON_KEY — copy .env.example to .env.local and set it.');

// Singleton browser client (ADR-0002). Anon key is public by design; auth is enforced by RLS.
export const supabase = createClient<Database>(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
