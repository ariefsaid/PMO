/**
 * activityLabel — friendly present-tense phrasing for the persistent activity trail.
 *
 * The raw step label is backend-driven (stepLabel() in the agent-chat handler emits
 * "Looking up projects…", "Logging an activity…", …) BEFORE each tool runs. That copy is
 * fine for a transient one-line hint but reads as opaque jargon in a persistent checklist,
 * so the trail rephrases the common lookups into reassuring, user-facing verbs. Unknown
 * labels fall back to the raw label with the trailing ellipsis trimmed.
 *
 * Pure function; never an authorization or persistence input.
 */

/**
 * Friendly present-tense phrasing for the activity trail. Falls back to the raw label
 * (with a trailing ellipsis trimmed) when no friendlier mapping is known.
 */
export function friendlyActivity(rawLabel: string): string {
  // rawLabel is like "Looking up projects…", "Looking up crm activities…", "Logging an activity…".
  const m = rawLabel.match(/^Looking up (.+?)…$/);
  if (m) {
    const e = m[1];
    const map: Record<string, string> = {
      projects: 'Checking your projects',
      'crm activities': 'Looking for CRM activity',
      tasks: 'Checking tasks',
      companies: 'Checking companies',
      contacts: 'Checking contacts',
      profiles: 'Resolving the team',
      procurements: 'Checking procurement',
      'purchase orders': 'Checking purchase orders',
      payments: 'Checking payments',
      notifications: 'Checking notifications',
      milestones: 'Checking milestones',
    };
    return map[e] ?? `Looking up ${e}`;
  }
  return rawLabel.replace(/…$/, '');
}
