// Owner setup at /manage/:slug: opening hours, resources, staff and their
// hours, and services. Create and edit only; nothing here deletes.

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  ApiError,
  ownerApi,
  type HoursRange,
  type OwnerService,
  type Resource,
  type ServiceInput,
  type StaffMember,
} from '../api';
import Button from '../components/Button';
import Field from '../components/Field';
import WeekHours from '../components/WeekHours';
import shell from '../shell.module.css';
import styles from './Setup.module.css';

interface Data {
  businessHours: HoursRange[];
  resources: Resource[];
  staff: StaffMember[];
  services: OwnerService[];
}

type State =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'forbidden' }
  | { kind: 'not-found' }
  | { kind: 'failed' }
  | { kind: 'ready'; data: Data };

const MESSAGES: Record<string, string> = {
  owner_only: 'Only owners can change this.',
  not_found: 'That no longer exists. Reload the page.',
  unknown_staff_or_resource: 'A selected staff member or resource no longer exists. Reload the page.',
};

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return MESSAGES[error.code] ?? error.code;
  return "Can't reach Whiteboard. Check your connection and try again.";
}

/** Runs a save and reports how it went, one line under the form. */
function useSave() {
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setStatus(null);
    try {
      await fn();
      setStatus({ ok: true, text: 'Saved.' });
    } catch (error) {
      setStatus({ ok: false, text: messageFor(error) });
    } finally {
      setBusy(false);
    }
  }
  const line = status ? (
    <p className={status.ok ? styles.saved : styles.problem} role={status.ok ? 'status' : 'alert'}>
      {status.text}
    </p>
  ) : null;
  return { run, busy, line };
}

export default function Setup() {
  const { slug = '' } = useParams();
  const [state, setState] = useState<State>({ kind: 'loading' });

  async function load() {
    try {
      const [bh, resources, staff, services] = await Promise.all([
        ownerApi.businessHours(slug),
        ownerApi.resources(slug),
        ownerApi.staff(slug),
        ownerApi.services(slug),
      ]);
      setState({ kind: 'ready', data: { businessHours: bh.hours, resources, staff, services } });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setState({ kind: 'signed-out' });
      else if (error instanceof ApiError && error.status === 403) setState({ kind: 'forbidden' });
      else if (error instanceof ApiError && error.status === 404) setState({ kind: 'not-found' });
      else setState({ kind: 'failed' });
    }
  }

  useEffect(() => {
    void load();
  }, [slug]);

  const frame = (body: ReactNode) => (
    <main className={shell.page}>
      <Link className={shell.wordmark} to="/account">
        Whiteboard
      </Link>
      {body}
    </main>
  );

  if (state.kind === 'loading') return frame(<p className={shell.lede}>Loading…</p>);
  if (state.kind === 'signed-out') {
    return frame(
      <p className={shell.lede}>
        <Link to="/signin">Sign in</Link> to set up your organization.
      </p>,
    );
  }
  if (state.kind === 'forbidden') return frame(<p className={shell.lede}>Only owners can set up this organization.</p>);
  if (state.kind === 'not-found') {
    return frame(<p className={shell.lede}>You don't have an organization at this address.</p>);
  }
  if (state.kind === 'failed') return frame(<p className={shell.lede}>Something went wrong. Try again in a moment.</p>);

  const { data } = state;
  const reload = () => void load();

  return frame(
    <>
      <h1 className={shell.title}>Set up</h1>
      <p className={shell.lede}>
        What customers can book at <Link to={`/${slug}`}>{`${window.location.host}/${slug}`}</Link>. Times are
        in your organization's own zone. <Link to={`/manage/${slug}/calendar`}>Open the calendar</Link>.
      </p>

      <BusinessHours slug={slug} initial={data.businessHours} />

      <section className={styles.section}>
        <h2 className={styles.heading}>Resources</h2>
        <p className={styles.note}>Rooms, chairs or equipment a service needs. Any one free resource will do.</p>
        <ul className={styles.list}>
          {data.resources.map((r) => (
            <li key={r.id}>{r.name}</li>
          ))}
        </ul>
        <AddByName label="New resource" action="Add resource" onAdd={(name) => ownerApi.addResource(slug, name)} done={reload} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Staff</h2>
        {data.staff.map((s) => (
          <StaffCard key={s.id} slug={slug} member={s} />
        ))}
        <AddByName label="New staff member" action="Add staff member" onAdd={(name) => ownerApi.addStaff(slug, name)} done={reload} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Services</h2>
        {data.services.map((s) => (
          <ServiceForm key={s.id} slug={slug} service={s} staff={data.staff} resources={data.resources} done={reload} />
        ))}
        <ServiceForm slug={slug} staff={data.staff} resources={data.resources} done={reload} />
      </section>
    </>,
  );
}

function BusinessHours({ slug, initial }: { slug: string; initial: HoursRange[] }) {
  const [hours, setHours] = useState(initial);
  const save = useSave();
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Opening hours</h2>
      <WeekHours label="When the organization is open" hours={hours} onChange={setHours} disabled={save.busy} />
      <div className={styles.actions}>
        <Button
          disabled={save.busy}
          onClick={() => save.run(async () => setHours((await ownerApi.saveBusinessHours(slug, hours)).hours))}
        >
          Save opening hours
        </Button>
      </div>
      {save.line}
    </section>
  );
}

function AddByName({
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

function StaffCard({ slug, member }: { slug: string; member: StaffMember }) {
  const [name, setName] = useState(member.name);
  const [hours, setHours] = useState(member.hours);
  const save = useSave();
  return (
    <div className={styles.card}>
      <Field label="Name" value={name} onChange={setName} maxLength={120} disabled={save.busy} />
      <WeekHours label={`${member.name}'s working hours`} hours={hours} onChange={setHours} disabled={save.busy} />
      <div className={styles.actions}>
        <Button
          disabled={save.busy || !name.trim()}
          onClick={() =>
            save.run(async () => {
              if (name.trim() !== member.name) await ownerApi.renameStaff(slug, member.id, name.trim());
              setHours((await ownerApi.saveStaffHours(slug, member.id, hours)).hours);
            })
          }
        >
          Save {member.name}
        </Button>
      </div>
      {save.line}
    </div>
  );
}

const EMPTY: ServiceInput = {
  name: '',
  durationMinutes: 60,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minimumNoticeMinutes: 60,
  staffIds: [],
  resourceIds: [],
};

function ServiceForm({
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
  const save = useSave();
  const set = (patch: Partial<ServiceInput>) => setForm((f) => ({ ...f, ...patch }));
  const toggle = (key: 'staffIds' | 'resourceIds', id: string) =>
    set({ [key]: form[key].includes(id) ? form[key].filter((x) => x !== id) : [...form[key], id] });
  const minutes = (value: string) => (value === '' ? 0 : Number.parseInt(value, 10));

  async function submit(event: FormEvent) {
    event.preventDefault();
    await save.run(async () => {
      if (service) {
        await ownerApi.saveService(slug, service.id, form);
      } else {
        await ownerApi.addService(slug, form);
        setForm(EMPTY);
        done();
      }
    });
  }

  return (
    <form className={styles.card} onSubmit={submit}>
      <h3 className={styles.cardTitle}>{service ? service.name : 'New service'}</h3>
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
          {service ? `Save ${service.name}` : 'Add service'}
        </Button>
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
