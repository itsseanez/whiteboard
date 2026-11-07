// Opening hours for the whole organization.

import { useState } from 'react';
import { ownerApi, type HoursRange } from '@/lib/api';
import Button from '@/components/ui/Button';
import WeekHours from '@/components/schedule/WeekHours';
import styles from './Setup.module.css';
import { Unsaved, sameHours, useSave, useTrackDirty } from './shared';

export function BusinessHours({ slug, initial }: { slug: string; initial: HoursRange[] }) {
  const [hours, setHours] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const save = useSave();
  const isDirty = !sameHours(hours, saved);
  useTrackDirty('business-hours', isDirty);
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Opening hours</h2>
      <WeekHours label="When the organization is open" hours={hours} onChange={setHours} disabled={save.busy} />
      <div className={styles.actions}>
        <Button
          disabled={save.busy}
          onClick={() =>
            save.run(async () => {
              const stored = (await ownerApi.saveBusinessHours(slug, hours)).hours;
              setHours(stored);
              setSaved(stored);
            })
          }
        >
          Save opening hours
        </Button>
        <Unsaved show={isDirty} />
      </div>
      {save.line}
    </section>
  );
}
