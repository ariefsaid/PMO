import { describe, it, expect, vi, beforeEach } from 'vitest';

const { listComments, createComment, archiveComment } = vi.hoisted(() => ({
  listComments: vi.fn(),
  createComment: vi.fn(),
  archiveComment: vi.fn(),
}));
vi.mock('@/src/lib/db/comments', () => ({ listComments, createComment, archiveComment }));

import { repositories } from './index';
import { AppError } from '@/src/lib/appError';

beforeEach(() => vi.clearAllMocks());

describe('comment repository', () => {
  it('delegates list/create/archive and returns the DAL result', async () => {
    const rows = [{ id: 'c1' }];
    listComments.mockResolvedValue(rows);
    await expect(repositories.comment.list('task', 't1')).resolves.toBe(rows);
    expect(listComments).toHaveBeenCalledWith('task', 't1');

    const input = { entityType: 'project' as const, entityId: 'p1', body: 'hi', mentions: [] };
    await repositories.comment.create(input);
    expect(createComment).toHaveBeenCalledWith(input);

    await repositories.comment.archive('c1');
    expect(archiveComment).toHaveBeenCalledWith('c1');
  });

  it('keeps the refusal code on a failed archive', async () => {
    archiveComment.mockRejectedValue(new AppError('Comment could not be deleted', '42501'));
    await expect(repositories.comment.archive('c1')).rejects.toMatchObject({ code: '42501' });
  });
});
