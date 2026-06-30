/**
 * ChatBubble — the user's own message in the transcript.
 * Right-aligned, secondary fill (NOT primary blue — One-Blue rule, design-plan §3/One-Blue).
 * Plain text only — D-A2-8; NFR-AP-SEC-002.
 * FR-AP-013; design-plan §3.
 */
import React from 'react';

interface ChatBubbleProps {
  text: string;
}

export const ChatBubble: React.FC<ChatBubbleProps> = ({ text }) => {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-md bg-secondary px-3 py-2 text-sm text-secondary-foreground">
        <span className="sr-only">You said: </span>
        {text}
      </div>
    </div>
  );
};
