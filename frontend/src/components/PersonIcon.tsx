import type { ReactNode } from 'react';

/** Head and shoulders in a circle, drawn in currentColor like TrashIcon. */
export default function PersonIcon(): ReactNode {
  return (
    <svg width="22" height="22" viewBox="0 0 16 16" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="7" />
        <circle cx="8" cy="6.25" r="2.5" />
        <path d="M3.4 13.1a5 5 0 0 1 9.2 0" />
      </g>
    </svg>
  );
}
