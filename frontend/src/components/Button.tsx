import type { ReactNode } from 'react';
import styles from './Button.module.css';

interface Props {
  children: ReactNode;
  variant?: 'primary' | 'secondary';
  type?: 'button' | 'submit';
  disabled?: boolean;
  onClick?: () => void;
}

/** type="button" by default, so a button inside a form never submits by accident. */
export default function Button({
  children,
  variant = 'primary',
  type = 'button',
  disabled,
  onClick,
}: Props): ReactNode {
  return (
    <button
      type={type}
      className={`${styles.button} ${styles[variant]}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
