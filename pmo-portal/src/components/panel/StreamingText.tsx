/**
 * StreamingText — an assistant answer as safe markdown (ADR-0054), with a quiet caret after it
 * while the answer is still arriving. The caret is decorative: the transcript's log region
 * announces additions, so the caret never reaches assistive tech and stops under reduced motion.
 * Adapted from MIT-licensed sources; notice in ./THIRD_PARTY_NOTICE.md.
 */
import React from 'react';
import { Markdown } from './Markdown';

export const StreamingText: React.FC<{ text: string; streaming?: boolean }> = ({ text, streaming = false }) => (
  <>
    <Markdown text={text} />
    {streaming && <span aria-hidden className="stream-caret mt-1 block h-4 w-0.5 rounded-full bg-foreground" />}
  </>
);
