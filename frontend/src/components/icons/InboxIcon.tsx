import type { ReactNode } from 'react';

/** An in-tray, drawn in currentColor like PersonIcon. */
export default function InboxIcon(): ReactNode {
  return (
    <svg width="22" height="22" viewBox="0 0 16 16" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 9.5 3.8 3.4A1 1 0 0 1 4.8 2.7h6.4a1 1 0 0 1 1 .7L14 9.5" />
        <path d="M2 9.5v3.3a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.5h-3.4l-.9 1.6H6.3l-.9-1.6Z" />
      </g>
    </svg>
  );
}
