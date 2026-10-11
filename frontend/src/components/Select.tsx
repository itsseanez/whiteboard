import { useId, type ReactNode } from 'react';
import styles from './Select.module.css';

interface Option {
  value: string;
  label: string;
}

interface Props {
  label: string;
  value: string;
  options: readonly Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

/**
 * A labelled native select.
 *
 * useId rather than a prop, so no caller can accidentally give two selects the
 * same id — which silently breaks the label association for both, and is
 * invisible until someone uses a screen reader or clicks a label.
 */
export default function Select({ label, value, options, onChange, disabled }: Props): ReactNode {
  const id = useId();

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div className={styles.wrap}>
        <select
          id={id}
          className={styles.select}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <svg className={styles.chevron} width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </div>
    </div>
  );
}
