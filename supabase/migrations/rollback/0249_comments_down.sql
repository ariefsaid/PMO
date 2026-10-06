-- Rollback for 0249_comments.sql
drop trigger if exists comments_notify_mentions_trg on public.comments;
drop function if exists public.notify_comment_mentions();
drop table if exists public.comments;
drop function if exists public.can_read_comment_parent(text, uuid);
