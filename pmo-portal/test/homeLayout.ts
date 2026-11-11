import { beforeEach } from 'vitest';
import type { HomeLayout } from '@/src/hooks/useHomeLayout';

/** Pin the per-device home layout for every test in the calling file (a home test describes one arrangement). */
export function pinHomeLayout(layout: HomeLayout) {
  beforeEach(() => localStorage.setItem('home-layout', layout));
}
