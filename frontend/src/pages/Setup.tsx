// Setup at /manage/:slug, for owners and managers: opening hours, resources,
// staff and their hours, services, and who can sign in. Removing archives; each
// card saves on its own and marks itself while it holds unsaved edits.

import { createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  ApiError,
  getTenantContext,
  ownerApi,
  peopleApi,
  type MemberRole,
  type PendingInvitation,
  type Person,
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
  role: string;
  members: Person[];
  invitations: PendingInvitation[];
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
  managers_only: 'Only owners and managers can change this.',
  owner_only: 'Only owners can do this.',
  staff_has_login: 'That staff member already has a sign-in.',
  already_member: 'That person already belongs to this organization.',
  invalid_email: 'That email address does not look right.',
  cannot_remove_owner: "An owner can't be removed.",
  email_unavailable: "Email isn't set up yet, so the invitation couldn't be sent. Try again once it is.",
  email_failed: "The invitation was saved but the email didn't go. Try sending it again.",
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
      const [context, people, bh, resources, staff, services] = await Promise.all([
        getTenantContext(slug),
        peopleApi.list(slug),
        ownerApi.businessHours(slug),
        ownerApi.resources(slug),
        ownerApi.staff(slug),
        ownerApi.services(slug),
      ]);
      setState({
        kind: 'ready',
        data: { role: context.membership.role, ...people, businessHours: bh.hours, resources, staff, services },
      });
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
  if (state.kind === 'forbidden') {
    return frame(
      <p className={shell.lede}>
        Only owners and managers can set up this organization. <Link to={`/manage/${slug}/me`}>See your week</Link>.
      </p>,
    );
  }
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
          <StaffCard key={s.id} slug={slug} member={s} login={loginOf(data, s.id)} removed={reload} />
        ))}
        <AddByName label="New staff member" action="Add staff member" onAdd={(name) => ownerApi.addStaff(slug, name)} done={reload} />
      </section>

      <People slug={slug} data={data} changed={reload} />

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

type Login = { kind: 'linked'; email: string } | { kind: 'invited'; email: string } | { kind: 'none' };

function loginOf(data: Data, staffId: string): Login {
  const member = data.members.find((m) => m.staffId === staffId);
  if (member) return { kind: 'linked', email: member.email };
  const invitation = data.invitations.find((i) => i.staffId === staffId);
  return invitation ? { kind: 'invited', email: invitation.email } : { kind: 'none' };
}

function StaffCard({
  slug,
  member,
  login,
  removed,
}: {
  slug: string;
  member: StaffMember;
  login: Login;
  removed: () => void;
}) {
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
      <StaffLogin slug={slug} staffId={member.id} name={saved.name} login={login} invited={removed} />
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

/** A staff member's own sign-in: invite them, or say who it is. */
function StaffLogin({
  slug,
  staffId,
  name,
  login,
  invited,
}: {
  slug: string;
  staffId: string;
  name: string;
  login: Login;
  invited: () => void;
}) {
  const [email, setEmail] = useState('');
  const save = useSave();
  useTrackDirty(`invite:${staffId}`, email.trim() !== '');
  const send = (address: string) =>
    save.run(async () => {
      await peopleApi.invite(slug, { email: address, role: 'staff', staffId });
      setEmail('');
      invited();
    });

  if (login.kind === 'linked') return <p className={styles.note}>Signs in as {login.email} to see their own week.</p>;
  if (login.kind === 'invited') {
    return (
      <div className={styles.actions}>
        <span className={styles.note}>Invitation sent to {login.email}.</span>
        <Button variant="secondary" disabled={save.busy} onClick={() => void send(login.email)}>
          Send again
        </Button>
        {save.line}
      </div>
    );
  }
  return (
    <form
      className={styles.inline}
      onSubmit={(event) => {
        event.preventDefault();
        if (email.trim()) void send(email.trim());
      }}
    >
      <Field label={`${name}'s email, to sign in`} type="email" value={email} onChange={setEmail} disabled={save.busy} />
      <Button type="submit" variant="secondary" disabled={save.busy || !email.trim()}>
        Invite {name}
      </Button>
      {save.line}
    </form>
  );
}

const ROLE_LABEL: Record<MemberRole, string> = { owner: 'Owner', admin: 'Manager', member: 'Staff' };

/** Who can sign in. Managers see it; only owners invite managers or remove anyone. */
function People({ slug, data, changed }: { slug: string; data: Data; changed: () => void }) {
  const isOwner = data.role === 'owner';
  const [email, setEmail] = useState('');
  const save = useSave();
  useTrackDirty('invite:manager', email.trim() !== '');
  const staffName = (id: string | null) => data.staff.find((s) => s.id === id)?.name;

  async function inviteManager(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    await save.run(async () => {
      await peopleApi.invite(slug, { email: email.trim(), role: 'manager' });
      setEmail('');
      changed();
    });
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>People</h2>
      <p className={styles.note}>
        Who can sign in. Managers run setup and the calendar and invite staff; only owners invite managers or
        remove anyone. Invite staff from their card above.
      </p>
      <ul className={styles.list}>
        {data.members.map((m) => (
          <li key={m.memberId} className={styles.row}>
            <span>
              {m.name} · {m.email}
            </span>
            <span className={styles.actions}>
              <span className={styles.note}>
                {ROLE_LABEL[m.role] ?? m.role}
                {m.staffId && staffName(m.staffId) ? ` · ${staffName(m.staffId)}` : ''}
              </span>
              {isOwner && m.role !== 'owner' ? (
                <RemoveButton
                  label={m.name}
                  onRemove={async () => {
                    await peopleApi.remove(slug, m.memberId);
                    changed();
                  }}
                />
              ) : null}
            </span>
          </li>
        ))}
        {data.invitations.map((i) => (
          <li key={i.id} className={styles.row}>
            <span>{i.email}</span>
            <span className={styles.note}>
              {ROLE_LABEL[i.role] ?? i.role} · invited{i.staffId && staffName(i.staffId) ? ` as ${staffName(i.staffId)}` : ''}
            </span>
          </li>
        ))}
      </ul>
      {isOwner ? (
        <form className={styles.inline} onSubmit={inviteManager}>
          <Field label="Manager's email" type="email" value={email} onChange={setEmail} disabled={save.busy} />
          <Button type="submit" variant="secondary" disabled={save.busy || !email.trim()}>
            Invite manager
          </Button>
          {save.line}
        </form>
      ) : null}
    </section>
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
