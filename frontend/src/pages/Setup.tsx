// Owner setup at /manage/:slug: opening hours, resources, staff and their
// hours, and services. Removing archives; each card saves on its own and
// marks itself while it holds unsaved edits.

import { createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
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
import IconButton, { TrashIcon } from '../components/IconButton';
import WeekHours from '../components/WeekHours';
import shell from '../shell.module.css';
import styles from './Setup.module.css';
import Problem from '../components/Problem';

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
  has_future_appointments: 'There are upcoming appointments. Move or cancel them in the calendar first.',
  only_resource_for_service:
    "It's the only resource a service can use. Give that service another resource, or remove the service, first.",
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
    status.ok ? (
      <p className={styles.saved} role="status">
        {status.text}
      </p>
    ) : (
      <Problem role="alert">{status.text}</Problem>
    )
  ) : null;
  return { run, busy, line };
}

// Each form reports whether it holds edits that haven't been saved, so the page
// can mark it and warn before the browser leaves with them.
const DirtyContext = createContext<(key: string, dirty: boolean) => void>(() => {});

function useTrackDirty(key: string, dirty: boolean) {
  const report = useContext(DirtyContext);
  useEffect(() => {
    report(key, dirty);
    return () => report(key, false);
  }, [report, key, dirty]);
}

/** Hours compared as a set: the server returns them sorted, the form keeps edit order. */
function sameHours(a: HoursRange[], b: HoursRange[]): boolean {
  const norm = (h: HoursRange[]) =>
    JSON.stringify([...h].sort((x, y) => x.weekday - y.weekday || x.start.localeCompare(y.start)));
  return norm(a) === norm(b);
}

function Unsaved({ show }: { show: boolean }) {
  return show ? <span className={styles.unsaved}>Unsaved changes</span> : null;
}

export default function Setup() {
  const { slug = '' } = useParams();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [dirty, setDirty] = useState<ReadonlySet<string>>(new Set());

  const report = useCallback((key: string, isDirty: boolean) => {
    setDirty((current) => {
      if (current.has(key) === isDirty) return current;
      const next = new Set(current);
      if (isDirty) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  // A reload, a closed tab or a typed URL would drop the edits; the browser asks first.
  useEffect(() => {
    if (dirty.size === 0) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

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
    <main className={`${shell.page} ${styles.page}`}>
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
    <DirtyContext.Provider value={report}>
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
            <li key={r.id} className={styles.row}>
              <span>{r.name}</span>
              <span className={styles.actions}>
                <RemoveButton
                  label={r.name}
                  onRemove={async () => {
                    await ownerApi.deleteResource(slug, r.id);
                    reload();
                  }}
                />
              </span>
            </li>
          ))}
        </ul>
        <AddByName label="New resource" action="Add resource" onAdd={(name) => ownerApi.addResource(slug, name)} done={reload} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Staff</h2>
        {data.staff.map((s) => (
          <StaffCard key={s.id} slug={slug} member={s} removed={reload} />
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
    </DirtyContext.Provider>,
  );
}

function BusinessHours({ slug, initial }: { slug: string; initial: HoursRange[] }) {
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

/** Two clicks, so a stray one can't remove anything. Past appointments keep their history. */
function RemoveButton({ label, onRemove }: { label: string; onRemove: () => Promise<unknown> }) {
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

function StaffCard({ slug, member, removed }: { slug: string; member: StaffMember; removed: () => void }) {
  const [name, setName] = useState(member.name);
  const [hours, setHours] = useState(member.hours);
  const [saved, setSaved] = useState({ name: member.name, hours: member.hours });
  const save = useSave();
  const isDirty = name.trim() !== saved.name || !sameHours(hours, saved.hours);
  useTrackDirty(`staff:${member.id}`, isDirty);
  return (
    <div className={styles.card}>
      <Field label="Name" value={name} onChange={setName} maxLength={120} disabled={save.busy} />
      <WeekHours label={`${saved.name}'s working hours`} hours={hours} onChange={setHours} disabled={save.busy} />
      <div className={styles.actions}>
        <Button
          disabled={save.busy || !name.trim()}
          onClick={() =>
            save.run(async () => {
              const newName = name.trim();
              if (newName !== saved.name) await ownerApi.renameStaff(slug, member.id, newName);
              const stored = (await ownerApi.saveStaffHours(slug, member.id, hours)).hours;
              setHours(stored);
              setSaved({ name: newName, hours: stored });
            })
          }
        >
          Save {saved.name}
        </Button>
        <Unsaved show={isDirty} />
        <RemoveButton
          label={saved.name}
          onRemove={async () => {
            await ownerApi.deleteStaff(slug, member.id);
            removed();
          }}
        />
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
