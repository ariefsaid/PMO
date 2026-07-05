/**
 * Markdown — the app's SOLE markdown surface (ADR-0049). Renders assistant PROSE only.
 * SECURITY (ADR-0039 boundary applied to prose, NFR-AXP-SEC-001):
 *   - NO rehype-raw / NO dangerouslySetInnerHTML → raw HTML in the model text is escaped/dropped, never executed.
 *   - disallowedElements + unwrapDisallowed strips script/style/iframe/form controls even if a plugin emitted them.
 *   - urlTransform (safeUrl) restricts link schemes; components.a forces rel + safe target.
 * Do NOT add rehype-raw or widen SAFE_SCHEMES without a security review (ADR-0049 §2).
 */
import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Safe href schemes (FR-AXP-003, ADR-0049 §2). Same-origin relative paths pass (no scheme). */
const SAFE_SCHEMES = ['http:', 'https:', 'mailto:'];
function safeUrl(url: string): string {
  try {
    // Relative URLs (no scheme) resolve against the app origin → allowed.
    const u = new URL(url, window.location.origin);
    return SAFE_SCHEMES.includes(u.protocol) ? url : ''; // '' → react-markdown renders inert text, no anchor
  } catch {
    return '';
  }
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div data-testid="assistant-markdown" className="text-sm text-foreground [&_*]:break-words prose-pmo">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        /* no rehypePlugins — raw HTML stays inert (ADR-0049 §2) */
        urlTransform={safeUrl}
        disallowedElements={['script', 'style', 'iframe', 'form', 'input', 'button', 'object', 'embed', 'link', 'meta']}
        unwrapDisallowed
        components={{
          a: ({ href, children, ...rest }) => {
            const isAbsolute = !!href && /^https?:/i.test(href);
            return (
              <a
                href={href}
                {...(isAbsolute ? { target: '_blank' } : {})}
                rel="noopener noreferrer nofollow"
                {...rest}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
