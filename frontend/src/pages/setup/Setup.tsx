// An organization's own page at /manage/:slug, for owners and managers. A column
// of tabs that stays in view: the calendar first, then setup in the order a new
// organization fills it: opening hours; staff; the accounts that can sign in;
// resources and the services that use both. The open tab is in ?tab=. Removing archives; each card saves on
// its own, marks itself while it holds unsaved edits, and so does its tab.

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, getTenantContext, ownerApi, peopleApi } from '@/lib/api';
import shell from '@/styles/shell.module.css';
import styles from './Setup.module.css';
import Tabs from '@/components/ui/Tabs';
import { CalendarView } from '@/pages/calendar/Calendar';
import TimeOff from '@/components/organization/TimeOff';
import { Accounts, ConnectApps } from './Accounts';
import { AddByName } from './AddByName';
import { BusinessHours } from './BusinessHours';
import { CloseOrganization } from './CloseOrganization';
import { RemoveButton } from './RemoveButton';
import { ServiceForm } from './Services';
import { StaffCard, loginOf } from './Staff';
import { DirtyContext, type State } from './shared';

/** Which tab a form's unsaved-edits key belongs to. */
function tabOf(key: string): string {
  if (key === 'business-hours') return 'hours';
  if (key.startsWith('service:') || key === 'add:New resource') return 'services';
  if (key === 'invite:manager') return 'accounts';
  if (key === 'time-off') return 'time-off';
  return 'staff';
}

export default function Setup() {
  const { slug = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'calendar';
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
        data: { name: context.tenant.name, timeZone: context.tenant.timezone, role: context.membership.role, ...people, businessHours: bh.hours, resources, staff, services },
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
    <main className={shell.page}>
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
  const reportTimeOff = (isDirty: boolean) => report('time-off', isDirty);
  const unsavedIn = (id: string) => [...dirty].some((key) => tabOf(key) === id);

  return frame(
    <DirtyContext.Provider value={report}>
      <h1 className={shell.title}>{data.name}</h1>
      <p className={shell.lede}>
        Customers book at <Link to={`/${slug}`}>{`${window.location.host}/${slug}`}</Link>. Times are in your
        organization's own zone.
      </p>

      <Tabs
        label="Organization"
        orientation="vertical"
        selected={tab}
        onSelect={(id) => setParams({ tab: id }, { replace: true })}
        tabs={[
          {
            id: 'calendar',
            label: 'Calendar',
            panel: <CalendarView slug={slug} />,
          },
          {
            id: 'hours',
            label: 'Opening hours',
            marked: unsavedIn('hours'),
            markLabel: 'unsaved changes',
            panel: (
              <div className={styles.column}>
                <BusinessHours slug={slug} initial={data.businessHours} />
              </div>
            ),
          },
          {
            id: 'staff',
            label: 'Staff',
            marked: unsavedIn('staff'),
            markLabel: 'unsaved changes',
            panel: (
              <div className={styles.column}>
                <section className={styles.section}>
                  <h2 className={styles.heading}>Staff</h2>
                  {data.staff.map((s) => (
                    <StaffCard key={s.id} slug={slug} member={s} login={loginOf(data, s.id)} removed={reload} />
                  ))}
                  <AddByName label="New staff member" action="Add staff member" onAdd={(name) => ownerApi.addStaff(slug, name)} done={reload} />
                </section>
              </div>
            ),
          },
          {
            id: 'time-off',
            label: 'Time off',
            marked: unsavedIn('time-off'),
            markLabel: 'unsaved changes',
            panel: (
              <div className={styles.column}>
                <section className={styles.section}>
                  <h2 className={styles.heading}>Time off</h2>
                  <TimeOff slug={slug} timeZone={data.timeZone} staff={data.staff} onDirty={reportTimeOff} />
                </section>
              </div>
            ),
          },
          {
            id: 'accounts',
            label: 'Accounts',
            marked: unsavedIn('accounts'),
            markLabel: 'unsaved changes',
            panel: (
              <div className={styles.column}>
                <Accounts slug={slug} data={data} changed={reload} />
                {data.role === 'owner' ? <ConnectApps slug={slug} /> : null}
                {data.role === 'owner' ? <CloseOrganization slug={slug} name={data.name} /> : null}
              </div>
            ),
          },
          {
            id: 'services',
            label: 'Services and resources',
            marked: unsavedIn('services'),
            markLabel: 'unsaved changes',
            panel: (
              <div className={styles.column}>
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
                  <h2 className={styles.heading}>Services</h2>
                  {data.services.map((s) => (
                    <ServiceForm key={s.id} slug={slug} service={s} staff={data.staff} resources={data.resources} done={reload} />
                  ))}
                  <ServiceForm slug={slug} staff={data.staff} resources={data.resources} done={reload} />
                </section>
              </div>
            ),
          },
        ]}
      />
    </DirtyContext.Provider>,
  );
}
