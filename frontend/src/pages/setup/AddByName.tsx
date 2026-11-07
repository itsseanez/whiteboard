import { useState, type FormEvent } from 'react';
import Button from '@/components/ui/Button';
import Field from '@/components/ui/Field';
import styles from './Setup.module.css';
import { useSave, useTrackDirty } from './shared';

export function AddByName({
  label,
  action,
  onAdd,
  done,
}: {
  label: string;
  action: string;
  onAdd: (name: string) => Promise<unknown>;
  done: () => void;
}) {
  const [name, setName] = useState('');
  const save = useSave();
  useTrackDirty(`add:${label}`, name.trim() !== '');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    await save.run(async () => {
      await onAdd(name.trim());
      setName('');
      done();
    });
  }
  return (
    <form className={styles.inline} onSubmit={submit}>
      <Field label={label} value={name} onChange={setName} maxLength={120} disabled={save.busy} />
      <Button type="submit" variant="secondary" disabled={save.busy || !name.trim()}>
        {action}
      </Button>
      {save.line}
    </form>
  );
}
