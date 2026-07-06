/**
 * Legal configuration seam — the ONE typed source for every site-specific value
 * the legal pages render (FR-LEG-006/007, NFR-LEG-005). Reads `VITE_LEGAL_*`
 * (plus the two legacy-unprefixed vars) build-time env vars and exports typed
 * constants with PRESENTABLE DEFAULTS so an unset env var NEVER renders a bracket
 * placeholder (FR-LEG-007, I6).
 *
 * Env-var naming is verbatim from spec FR-LEG-007 — do NOT "normalize":
 *   LEGAL_ENTITY_NAME ← VITE_LEGAL_ENTITY_NAME   (default "PMO Portal")
 *   DOMAIN            ← VITE_LEGAL_DOMAIN        (default "pmoportal.app")
 *   CONTACT_EMAIL     ← VITE_LEGAL_CONTACT_EMAIL (default "support@pmoportal.app")
 *   HELP_WHATSAPP     ← VITE_HELP_WHATSAPP        (default ""  → Help omitted, FR-LEG-010)
 *   HOSTING_LOCATION  ← VITE_HOSTING_LOCATION     (default "Singapore"; per-client, ADR-0047)
 *
 * Provisioning: set these per client at build time — see docs/environments.md
 * "Frontend on Cloudflare Pages". HELP_WHATSAPP is a single global value for the
 * single-tenant MVP; the org_id seam makes it per-org later (M15).
 */
export const LEGAL_ENTITY_NAME: string =
  import.meta.env.VITE_LEGAL_ENTITY_NAME ?? 'PMO Portal';

export const DOMAIN: string = import.meta.env.VITE_LEGAL_DOMAIN ?? 'pmoportal.app';

export const CONTACT_EMAIL: string =
  import.meta.env.VITE_LEGAL_CONTACT_EMAIL ?? 'support@pmoportal.app';

/** E.164 WhatsApp support number (e.g. "6281234567890"). Empty → Help omitted. */
export const HELP_WHATSAPP: string = import.meta.env.VITE_HELP_WHATSAPP ?? '';

/** Hosting location for the data-residency disclosure (per-client Supabase Cloud Pro). */
export const HOSTING_LOCATION: string = import.meta.env.VITE_HOSTING_LOCATION ?? 'Singapore';

/**
 * The wa.me Help URL. Empty when HELP_WHATSAPP is unset (FR-LEG-010). Consumers
 * MUST check truthiness before rendering any Help affordance so a broken
 * `wa.me/` link never renders.
 */
export const HELP_URL: string = HELP_WHATSAPP ? `https://wa.me/${HELP_WHATSAPP}` : '';
