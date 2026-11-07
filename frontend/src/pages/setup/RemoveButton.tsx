import { useState } from 'react';
import Button from '@/components/ui/Button';
import IconButton, { TrashIcon } from '@/components/ui/IconButton';
import { useSave } from './shared';

/** Two clicks, so a stray one can't remove anything. Past appointments keep their history. */
export function RemoveButton({ label, onRemove }: { label: string; onRemove: () => Promise<unknown> }) {
  const [confirming, setConfirming] = useState(false);
  const save = useSave();
  return (
    <>
      {confirming ? (
        <Button variant="secondary" disabled={save.busy} onClick={() => save.run(onRemove)}>
          Yes, remove {label}
        </Button>
      ) : (
        <IconButton label={`Remove ${label}`} disabled={save.busy} onClick={() => setConfirming(true)}>
          <TrashIcon />
        </IconButton>
      )}
      {save.line}
    </>
  );
}
