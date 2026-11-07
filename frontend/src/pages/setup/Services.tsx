// The form that creates or edits a service.

import { useState, type FormEvent } from 'react';
import { ownerApi, type OwnerService, type Resource, type ServiceInput, type StaffMember } from '@/lib/api';
import Button from '@/components/ui/Button';
import Field from '@/components/ui/Field';
import styles from './Setup.module.css';
import { RemoveButton } from './RemoveButton';
import { Unsaved, useSave, useTrackDirty } from './shared';

const EMPTY: ServiceInput = {
  name: '',
  durationMinutes: 60,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minimumNoticeMinutes: 60,
  staffIds: [],
  resourceIds: [],
};

export function ServiceForm({
  slug,
  service,
  staff,
  resources,
  done,
}: {
  slug: string;
  service?: OwnerService;
  staff: StaffMember[];
  resources: Resource[];
  done: () => void;
}) {
  const [form, setForm] = useState<ServiceInput>(service ?? EMPTY);
  const [saved, setSaved] = useState<ServiceInput>(service ?? EMPTY);
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const isDirty =
    form.name.trim() !== saved.name ||
    form.durationMinutes !== saved.durationMinutes ||
    form.bufferBeforeMinutes !== saved.bufferBeforeMinutes ||
    form.bufferAfterMinutes !== saved.bufferAfterMinutes ||
    form.minimumNoticeMinutes !== saved.minimumNoticeMinutes ||
    !sameSet(form.staffIds, saved.staffIds) ||
    !sameSet(form.resourceIds, saved.resourceIds);
  useTrackDirty(`service:${service?.id ?? 'new'}`, isDirty);
  const save = useSave();
  const set = (patch: Partial<ServiceInput>) => setForm((f) => ({ ...f, ...patch }));
  const toggle = (key: 'staffIds' | 'resourceIds', id: string) =>
    set({ [key]: form[key].includes(id) ? form[key].filter((x) => x !== id) : [...form[key], id] });
  const minutes = (value: string) => (value === '' ? 0 : Number.parseInt(value, 10));

  async function submit(event: FormEvent) {
    event.preventDefault();
    await save.run(async () => {
      if (service) {
        const stored = await ownerApi.saveService(slug, service.id, form);
        setForm(stored);
        setSaved(stored);
      } else {
        await ownerApi.addService(slug, form);
        setForm(EMPTY);
        done();
      }
    });
  }

  return (
    <form className={styles.card} onSubmit={submit}>
      <h3 className={styles.cardTitle}>{service ? saved.name : 'New service'}</h3>
      <Field label="Name" value={form.name} onChange={(name) => set({ name })} maxLength={120} disabled={save.busy} />
      <div className={styles.numbers}>
        <NumberField label="Duration (min)" value={form.durationMinutes} min={5} onChange={(v) => set({ durationMinutes: minutes(v) })} />
        <NumberField label="Buffer before (min)" value={form.bufferBeforeMinutes} min={0} onChange={(v) => set({ bufferBeforeMinutes: minutes(v) })} />
        <NumberField label="Buffer after (min)" value={form.bufferAfterMinutes} min={0} onChange={(v) => set({ bufferAfterMinutes: minutes(v) })} />
        <NumberField label="Notice (min)" value={form.minimumNoticeMinutes} min={0} onChange={(v) => set({ minimumNoticeMinutes: minutes(v) })} />
      </div>
      <Checks
        legend="Who can do it"
        empty="Add staff first."
        items={staff}
        checked={form.staffIds}
        onToggle={(id) => toggle('staffIds', id)}
      />
      <Checks
        legend="Needs a resource (leave all unticked if not)"
        empty="No resources yet."
        items={resources}
        checked={form.resourceIds}
        onToggle={(id) => toggle('resourceIds', id)}
      />
      <div className={styles.actions}>
        <Button type="submit" variant={service ? 'primary' : 'secondary'} disabled={save.busy || !form.name.trim()}>
          {service ? `Save ${saved.name}` : 'Add service'}
        </Button>
        <Unsaved show={isDirty} />
        {service ? (
          <RemoveButton
            label={saved.name}
            onRemove={async () => {
              await ownerApi.deleteService(slug, service.id);
              done();
            }}
          />
        ) : null}
      </div>
      {save.line}
    </form>
  );
}

function NumberField({ label, value, min, onChange }: { label: string; value: number; min: number; onChange: (v: string) => void }) {
  return (
    <label className={styles.number}>
      <span>{label}</span>
      <input type="number" min={min} step={5} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Checks({
  legend,
  empty,
  items,
  checked,
  onToggle,
}: {
  legend: string;
  empty: string;
  items: { id: string; name: string }[];
  checked: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <fieldset className={styles.checks}>
      <legend>{legend}</legend>
      {items.length === 0 ? <span className={styles.note}>{empty}</span> : null}
      {items.map((item) => (
        <label key={item.id} className={styles.check}>
          <input type="checkbox" checked={checked.includes(item.id)} onChange={() => onToggle(item.id)} />
          {item.name}
        </label>
      ))}
    </fieldset>
  );
}
