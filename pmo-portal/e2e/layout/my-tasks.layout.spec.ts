// @e2e-isolation: read-only — layout measurements on a seeded route; no writes.
import { registerLayoutSweep } from '../support/layout-sweep';

registerLayoutSweep({ path: '/my-tasks', label: 'my-tasks', icons: true, integrations: false });
