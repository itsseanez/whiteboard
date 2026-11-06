import type { ReactNode } from 'react';
import styles from './IconButton.module.css';

interface Props {
  label: string; // the accessible name; the icon carries no text
  onClick: () => void;
  disabled?: boolean;
  size?: 'regular' | 'small';
  children: ReactNode;
}

export default function IconButton({ label, onClick, disabled, size = 'regular', children }: Props): ReactNode {
  return (
    <button
      type="button"
      className={`${styles.icon} ${styles[size]}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** A plain trash can, drawn in currentColor so it follows the button's state. */
export function TrashIcon(): ReactNode {
  return (
    <svg width="20" height="20" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M1.5 3.5h11M5.5 3.5V2a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1.5M3 3.5l.7 8.6a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.6M5.75 6v4.5M8.25 6v4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
