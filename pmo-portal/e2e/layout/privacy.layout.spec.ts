// @e2e-isolation: read-only — layout measurements on a seeded route; no writes.
import { registerLayoutSweep } from '../support/layout-sweep';

registerLayoutSweep({ path: '/privacy', label: 'privacy', icons: true, integrations: false });
