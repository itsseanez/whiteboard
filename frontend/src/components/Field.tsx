import { useId, type HTMLInputAutoCompleteAttribute, type ReactNode } from 'react';
import styles from './Field.module.css';

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'email' | 'password' | 'tel';
  autoComplete?: HTMLInputAutoCompleteAttribute;
  required?: boolean;
  disabled?: boolean;
  maxLength?: number;
  hint?: string;
}

/** A labelled text input. useId for the label association, as in Select. */
export default function Field({ label, onChange, hint, type = 'text', ...input }: Props): ReactNode {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        {...input}
        id={id}
        type={type}
        className={styles.input}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={hint ? hintId : undefined}
      />
      {hint ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
