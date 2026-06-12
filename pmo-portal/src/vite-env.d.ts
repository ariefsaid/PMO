/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
  readonly VITE_ANALYTICS_ENABLED?: string;
  readonly VITE_DEMO_MODE?: string;
  readonly VITE_APP_ENV?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
