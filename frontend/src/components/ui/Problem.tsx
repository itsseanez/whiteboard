import type { ReactNode, Ref } from 'react';
import styles from './Problem.module.css';

interface Props {
  children: ReactNode;
  /** 'alert' for something that just went wrong; omit for a standing notice. */
  role?: 'alert' | undefined;
  /** Spacing from the page around it; the look itself lives here. */
  className?: string | undefined;
  as?: 'p' | 'div';
  ref?: Ref<HTMLParagraphElement & HTMLDivElement>;
}

/** The black-ruled box every page uses to say something went wrong. */
export default function Problem({ children, role, className, as: Tag = 'p', ref }: Props): ReactNode {
  return (
    <Tag ref={ref} role={role} className={className ? `${styles.problem} ${className}` : styles.problem}>
      {children}
    </Tag>
  );
}
