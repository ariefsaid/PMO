/**
 * RichNoteView — the read view for stored note text (#2062).
 *
 * The stored string is UNTRUSTED input (typed by any author, years ago or minutes ago). It
 * renders through react-markdown as React elements — NO rehype-raw, NO dangerouslySetInnerHTML —
 * mirroring the assistant markdown boundary (ADR-0054 §2, ADR-0039): raw HTML in the text is
 * escaped/inert, script/style/iframe/form/img never mount, and `urlTransform` admits only
 * http(s)/mailto/same-origin links, so a `javascript:` URL renders as inert text.
 *
 * Legacy plain-text rows render unchanged: plain text is valid markdown, so pre-#2062 notes
 * keep their exact characters (the schema test pins the round-trip). Notes columns stay plain
 * text — markdown in, markdown out, no migration (#2062 storage rule).
 */
import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Safe href schemes; relative (no scheme) URLs pass and resolve against the app origin. */
const SAFE_SCHEMES = ['http:', 'https:', 'mailto:'];
function safeUrl(url: string): string {
  try {
    const u = new URL(url, window.location.origin);
    return SAFE_SCHEMES.includes(u.protocol) ? url : ''; // '' → react-markdown renders inert text, no anchor
  } catch {
    return '';
  }
}

export const RichNoteView: React.FC<{
  text: string | null | undefined;
  testId?: string;
  className?: string;
}> = memo(function RichNoteView({ text, testId = 'rich-note-view', className = '' }) {
  // An empty note leaves no wrapper at all — the row keeps its structure, no stray padding.
  if (!text?.trim()) return null;
  return (
    <div
      data-testid={testId}
      className={`rich-note-view text-[13px] leading-relaxed text-foreground [&_a]:underline underline-offset-2 [&_*]:break-words ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        /* no rehypePlugins — raw HTML stays inert */
        urlTransform={safeUrl}
        disallowedElements={['script', 'style', 'iframe', 'form', 'input', 'button', 'object', 'embed', 'link', 'meta', 'img']}
        unwrapDisallowed
        components={{
          ul: ({ children }) => <ul className="my-1 list-disc pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-1 list-decimal pl-5">{children}</ol>,
          li: ({ children }) => <li className="my-0.5">{children}</li>,
          p: ({ children }) => <p className="my-1 first:mt-0 last:mb-0">{children}</p>,
          a: ({ href, children }) => (
            <a href={href} rel="noopener noreferrer nofollow" className="text-primary">
              {children}
            </a>
          ),
        }}
      >
        {text ?? ''}
      </ReactMarkdown>
    </div>
  );
});
