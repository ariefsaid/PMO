// @e2e-isolation: read-only — layout measurements on a seeded route; no writes.
import { registerLayoutSweep } from '../support/layout-sweep';

registerLayoutSweep({ path: '/integrations', label: 'personal-integrations (AC-RAM-003)', icons: false, integrations: true });
