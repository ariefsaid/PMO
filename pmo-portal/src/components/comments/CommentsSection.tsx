import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/auth/useAuth';
import { useComments, useCommentMutations } from '@/src/hooks/useComments';
import { useAssignableProfiles } from '@/src/hooks/useTasks';
import type { CommentEntityType } from '@/src/lib/db/comments';
import { formatRelativeTime } from '@/src/lib/format';
import { Button } from '@/src/components/ui/Button';
import { ConfirmDialog } from '@/src/components/ui/ConfirmDialog';
import { SectionHeader } from '@/src/components/ui/SectionHeader';
import { TextArea } from '@/src/components/ui/FormFields';

const MAX_LEN = 4000;

/** The trailing `@query` the caret-at-end user is typing, or null. */
function activeMention(body: string): string | null {
  const m = /(?:^|\s)@([^\s@]*)$/.exec(body);
  return m ? m[1] : null;
}

export interface CommentsSectionProps {
  entityType: CommentEntityType;
  entityId: string;
}

/**
 * Plain-text comments on a project or task (#790): newest last, author + relative time, `@` picks an
 * org member. RLS is the authority (readers of the parent read/post; only the author deletes).
 */
export const CommentsSection: React.FC<CommentsSectionProps> = ({ entityType, entityId }) => {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const comments = useComments(entityType, entityId);
  const profiles = useAssignableProfiles();
  const { post, remove } = useCommentMutations(entityType, entityId);
  const [body, setBody] = useState('');
  const [picked, setPicked] = useState<{ id: string; name: string }[]>([]);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const query = activeMention(body);
  const suggestions = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return (profiles.data ?? [])
      .filter((p) => p.id !== currentUser?.id && p.status === 'active' && p.full_name.toLowerCase().includes(q))
      .slice(0, 5);
  }, [query, profiles.data, currentUser?.id]);

  const pick = (id: string, name: string) => {
    setBody((b) => b.replace(/@[^\s@]*$/, `@${name} `));
    setPicked((p) => (p.some((x) => x.id === id) ? p : [...p, { id, name }]));
  };

  const tooLong = body.length > MAX_LEN;
  const canPost = body.trim().length > 0 && !tooLong && !post.isPending;

  const submit = async () => {
    // A mention counts only while its `@Name` is still in the text.
    const mentions = picked.filter((p) => body.includes(`@${p.name}`)).map((p) => p.id);
    try {
      await post.mutateAsync({ body, mentions });
      setBody('');
      setPicked([]);
    } catch {
      /* surfaced via post.isError */
    }
  };

  return (
    <section aria-label={t('comments.title', 'Comments')} data-testid="comments-section">
      <SectionHeader title={t('comments.title', 'Comments')} />
      {comments.isLoading ? (
        <p className="text-sm text-muted-foreground">{t('comments.loading', 'Loading comments…')}</p>
      ) : comments.isError ? (
        <p role="alert" className="text-sm text-destructive-text">{t('comments.loadError', "Couldn't load comments. Try again shortly.")}</p>
      ) : (comments.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('comments.empty', 'No comments yet.')}</p>
      ) : (
        <ul className="mb-3 space-y-3">
          {(comments.data ?? []).map((c) => (
            <li key={c.id} className="rounded-lg border border-border p-3" data-testid="comment-item">
              <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  <span className="font-medium text-foreground">
                    {c.author?.full_name ?? t('comments.unknownAuthor', 'Former member')}
                  </span>
                  {' · '}
                  <time dateTime={c.created_at}>{formatRelativeTime(c.created_at)}</time>
                </span>
                {c.author_id === currentUser?.id && (
                  <Button variant="ghost" size="sm" onClick={() => setConfirmId(c.id)}>
                    {t('comments.delete', 'Delete')}
                  </Button>
                )}
              </div>
              <p className="whitespace-pre-wrap break-words text-sm">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2">
        <TextArea
          label={t('comments.label', 'Add a comment')}
          placeholder={t('comments.placeholder', 'Write a comment. Type @ to mention a colleague.')}
          value={body}
          onChange={setBody}
          error={tooLong ? t('comments.tooLong', 'Comments are limited to 4000 characters.') : undefined}
          fullWidth
        />
        {suggestions.length > 0 && (
          <ul role="listbox" aria-label={t('comments.mentionList', 'Mention a colleague')} className="rounded-lg border border-border bg-background">
            {suggestions.map((p) => (
              <li key={p.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => pick(p.id, p.full_name)}
                >
                  {p.full_name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {post.isError && <p role="alert" className="text-sm text-destructive-text">{t('comments.postError', "Couldn't post the comment. Try again.")}</p>}
        {remove.isError && <p role="alert" className="text-sm text-destructive-text">{t('comments.deleteError', "Couldn't delete the comment.")}</p>}
        <div className="flex justify-end">
          <Button onClick={submit} disabled={!canPost} loading={post.isPending}>
            {post.isPending ? t('comments.posting', 'Posting…') : t('comments.post', 'Post comment')}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmId !== null}
        title={t('comments.deleteTitle', 'Delete this comment?')}
        description={t('comments.deleteDescription', 'It will no longer show on this record.')}
        confirmLabel={t('comments.delete', 'Delete')}
        tone="destructive"
        loading={remove.isPending}
        onConfirm={() => {
          if (confirmId) remove.mutate(confirmId, { onSettled: () => setConfirmId(null) });
        }}
        onCancel={() => setConfirmId(null)}
      />
    </section>
  );
};
