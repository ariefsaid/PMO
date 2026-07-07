/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
  readonly VITE_ANALYTICS_ENABLED?: string;
  readonly VITE_DEMO_MODE?: string;
  readonly VITE_APP_ENV?: string;
  // Legal config seam (FR-LEG-006/007) — presentable defaults in src/lib/legalConfig.ts
  readonly VITE_LEGAL_ENTITY_NAME?: string;
  readonly VITE_LEGAL_DOMAIN?: string;
  readonly VITE_LEGAL_CONTACT_EMAIL?: string;
  readonly VITE_HELP_WHATSAPP?: string;
  readonly VITE_HOSTING_LOCATION?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// ADR-0042 §4: build-time version identity, inlined by Vite `define` in
// vite.config.ts. Source of truth for the in-app `vX.Y.Z · <sha>` label.
declare const __APP_VERSION__: string;
declare const __GIT_SHA__: string;
declare const __BUILD_TIME__: string;
