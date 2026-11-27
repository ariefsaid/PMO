import { expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/src/lib/db/equipment', () => ({ listAssets: h.list }));
import { equipmentRepository } from './equipment';
it('reads the later equipment page requested by the register', async () => {
  h.list.mockImplementation(async (offset = 0) => ({ rows: [{ id: offset === 200 ? 'last-machine' : 'first-machine' }], truncated: false }));
  const page = await equipmentRepository.listAssets(200);
  expect(page.rows[0].id).toBe('last-machine');
});
