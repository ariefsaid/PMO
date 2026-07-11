/**
 * Display-label map for external integration tiers and domains (OD-EAS-LABELS).
 *
 * Converts raw slugs from the DB (e.g., 'clickup', 'tasks') to human-readable labels
 * for UI rendering. Falls back to the raw slug for unmapped values to support future
 * tiers/domains without code changes.
 */

/**
 * Known tier label mappings (slug → human label).
 */
const TIER_LABELS: Record<string, string> = {
  clickup: 'ClickUp',
};

/**
 * Known domain label mappings (slug → human label).
 */
const DOMAIN_LABELS: Record<string, string> = {
  tasks: 'Tasks',
};

/**
 * Convert a tier slug to a human-readable label.
 * Falls back to the raw slug for unmapped tiers.
 *
 * @param tier - The tier slug from the DB
 * @returns The human-readable label, or the raw slug if unmapped
 */
export function tierLabel(tier: string): string {
  return TIER_LABELS[tier] ?? tier;
}

/**
 * Convert a domain slug to a human-readable label.
 * Falls back to the raw slug for unmapped domains.
 *
 * @param domain - The domain slug from the DB
 * @returns The human-readable label, or the raw slug if unmapped
 */
export function domainLabel(domain: string): string {
  return DOMAIN_LABELS[domain] ?? domain;
}