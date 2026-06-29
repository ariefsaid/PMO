// This config is ONLY for `drizzle-kit pull` (read-only introspection).
// We NEVER run `drizzle-kit push` / `drizzle-kit generate` here — Supabase
// migrations (supabase/migrations/*) remain the single schema source of
// truth (ADR-0036 §8). The output below is a throwaway mirror used purely to
// prove claim #2 (pull mirrors the existing schema without wanting to own it).
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './drizzle/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.SPIKE_DB_URL!,
  },
});
