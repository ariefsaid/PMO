import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/auth/useAuth';
import { useComments, useCommentMutations } from '@/src/hooks/useComments';
import { useAssignableProfiles } from '@/src/hooks/useTasks';
import type { CommentEntityType } from '@/src/lib/db/comments';
import { formatDate, formatRelativeTime } from '@/src/lib/format';
import { Button } from '@/src/components/ui/Button';
import { ConfirmDialog } from '@/src/components/ui/ConfirmDialog';
import { SectionHeader } from '@/src/components/ui/SectionHeader';
import { TextArea } from '@/src/components/ui/FormFields';

const MAX_LEN = 4000;
/** Mirrors the `comments_mentions_cap` CHECK. */
const MAX_MENTIONS = 20;

/** The trailing `@query` the caret-at-end user is typing, or null. */
function activeMention(body: string): string | null {
  const m = /(?:^|\s)@([^\s@]*)$/.exec(body);
  return m ? m[1] : null;
}

export interface CommentsSectionProps {
  entityType: CommentEntityType;
  entityId: string;
  /** Omit the section title when the host already names the area (e.g. the project Activity tab). */
  hideTitle?: boolean;
}

/**
 * Plain-text comments on a project or task (#790): newest last, author + relative time, `@` picks an
 * org member. RLS is the authority (readers of the parent read/post; only the author deletes).
 */
export const CommentsSection: React.FC<CommentsSectionProps> = ({ entityType, entityId, hideTitle = false }) => {
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

  const mentionCount = picked.filter((p) => body.includes(`@${p.name}`)).length;
  const mentionsFull = mentionCount >= MAX_MENTIONS;

  const pick = (id: string, name: string) => {
    if (mentionsFull && !picked.some((x) => x.id === id)) return;
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
      {!hideTitle && <SectionHeader title={t('comments.title', 'Comments')} />}
      {comments.isLoading ? (
        <p className="text-sm text-muted-foreground">{t('comments.loading', 'Loading comments…')}</p>
      ) : comments.isError ? (
        <p role="alert" className="text-sm text-destructive-text">{t('comments.loadError', "Couldn't load comments. Try again shortly.")}</p>
      ) : (comments.data ?? []).length === 0 ? (
        <p className="mb-4 text-sm text-muted-foreground">{t('comments.empty', 'No comments yet.')}</p>
      ) : (
        <ul className="mb-6 flex flex-col gap-5">
          {(comments.data ?? []).map((c) => {
            const name = c.author?.full_name ?? t('comments.unknownAuthor', 'Former member');
            return (
              <li key={c.id} className="flex gap-3" data-testid="comment-item">
                <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-foreground">
                  {name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-semibold text-foreground">{name}</span>
                    <time dateTime={c.created_at} className="text-xs text-muted-foreground">{formatDate(c.created_at)} · {formatRelativeTime(c.created_at)}</time>
                    {c.author_id === currentUser?.id && (
                      <button type="button" onClick={() => setConfirmId(c.id)} className="touch-target ml-auto inline-flex items-center text-xs text-muted-foreground hover:text-destructive-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {t('comments.delete', 'Delete')}
                      </button>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">{c.body}</p>
                </div>
              </li>
            );
          })}
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
        {mentionsFull && (
          <p className="text-sm text-muted-foreground">{t('comments.mentionsFull', 'You can mention at most 20 colleagues in one comment.')}</p>
        )}
        {suggestions.length > 0 && !mentionsFull && (
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
